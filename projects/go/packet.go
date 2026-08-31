package sonicws

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sync"

	"github.com/liwybloc/sonic-ws/projects/go/internal/core"
)

// MaxValues is the largest field count representable by a packet schema.
const MaxValues = 2_048_383

// Type identifies a SonicWS field codec.
type Type byte

const (
	None Type = iota
	Raw
	ASCII
	UTF16
	Enums
	Bytes
	UBytes
	Shorts
	UShorts
	VarInt
	UVarInt
	Deltas
	Floats
	Doubles
	Bools
	_
	JSON
	Hex
)

func validType(t Type) bool   { return t <= Bools || t == JSON || t == Hex }
func numericType(t Type) bool { return t >= Bytes && t <= Doubles && t != Bools }

// Undefined is the enum value distinct from nil.
type Undefined struct{}

// Enum defines a named set of wire values.
type Enum struct {
	Name   string
	Values []any
}

// Field defines one packet field and its value-count bounds.
type Field struct {
	Type Type
	Min  uint32
	Max  uint32
	Enum *Enum
}

// Quantization maps logical numbers to fixed-point wire values.
type Quantization struct {
	Scale                float64
	DisableErrorTracking bool
}

func (q Quantization) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Scale      float64 `json:"scale"`
		TrackError bool    `json:"trackError"`
	}{q.Scale, !q.DisableErrorTracking})
}

func (q *Quantization) UnmarshalJSON(data []byte) error {
	var value struct {
		Scale      float64 `json:"scale"`
		TrackError *bool   `json:"trackError"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	q.Scale = value.Scale
	q.DisableErrorTracking = value.TrackError != nil && !*value.TrackError
	return nil
}

// Group carries packet-group metadata exchanged in the schema.
type Group struct {
	Parent      string   `json:"parent"`
	Variant     string   `json:"variant"`
	IsParent    bool     `json:"isParent"`
	Permutation []string `json:"permutation,omitempty"`
}

// PacketConfig defines an immutable packet schema.
type PacketConfig struct {
	Tag         string
	Fields      []Field
	Object      bool
	Schema      []string
	Quantized   *Quantization
	Min         *float64
	Max         *float64
	Group       *Group
	Constructor string
	Replay      bool
	DontSpread  bool
	Async       bool
	AutoFlatten bool
	Rereference bool
	Compress    bool
	BatchMillis byte
	MaxBatch    int
}

// Packet validates and converts one negotiated packet type.
type Packet struct {
	tag         string
	fields      []Field
	object      bool
	schema      []string
	quantized   *Quantization
	valueMin    *float64
	valueMax    *float64
	group       *Group
	constructor string
	replay      bool
	dontSpread  bool
	async       bool
	autoFlatten bool
	rereference bool
	compress    bool
	batchMillis byte
	maxBatch    int

	quantMu  sync.Mutex
	residual map[uint64][]float64
}

// NewPacket validates config and builds a packet.
func NewPacket(config PacketConfig) (*Packet, error) {
	if config.Tag == "" {
		return nil, errors.New("sonicws: packet tag is required")
	}
	if _, err := latin1(config.Tag); err != nil {
		return nil, err
	}
	if len(config.Fields) == 0 || len(config.Fields) > 255 {
		return nil, errors.New("sonicws: packet needs 1 to 255 fields")
	}
	if !config.Object && len(config.Fields) != 1 {
		return nil, errors.New("sonicws: non-object packets need one field")
	}
	fields := append([]Field(nil), config.Fields...)
	for n := range fields {
		field := &fields[n]
		if !validType(field.Type) {
			return nil, fmt.Errorf("sonicws: unknown packet type %d", field.Type)
		}
		if field.Type == None {
			field.Min, field.Max = 0, 0
		} else if field.Max == 0 {
			field.Min, field.Max = 1, 1
		}
		if field.Min > field.Max || field.Max > MaxValues {
			return nil, fmt.Errorf("sonicws: invalid field range [%d,%d]", field.Min, field.Max)
		}
		if field.Type == Enums {
			if err := validateEnum(field.Enum); err != nil {
				return nil, err
			}
		} else if field.Enum != nil {
			return nil, errors.New("sonicws: enum data belongs to an ENUMS field")
		}
	}
	if config.AutoFlatten && len(config.Schema) == 0 {
		return nil, errors.New("sonicws: automatic mapping requires a schema")
	}
	if len(config.Schema) != 0 {
		if config.Object && len(config.Schema) != len(fields) {
			return nil, errors.New("sonicws: schema length does not match object fields")
		}
		seen := make(map[string]struct{}, len(config.Schema))
		for _, name := range config.Schema {
			if name == "" {
				return nil, errors.New("sonicws: schema fields cannot be empty")
			}
			if _, ok := seen[name]; ok {
				return nil, fmt.Errorf("sonicws: duplicate schema field %q", name)
			}
			seen[name] = struct{}{}
		}
	}
	if config.Quantized != nil {
		q := config.Quantized
		if config.Object || !numericType(fields[0].Type) || q.Scale <= 0 || math.IsNaN(q.Scale) || math.IsInf(q.Scale, 0) {
			return nil, errors.New("sonicws: invalid quantization")
		}
	}
	if (config.Min != nil || config.Max != nil) && (config.Object || !numericType(fields[0].Type)) {
		return nil, errors.New("sonicws: numeric limits require one numeric field")
	}
	if config.Min != nil && (math.IsNaN(*config.Min) || math.IsInf(*config.Min, 0)) {
		return nil, errors.New("sonicws: minimum must be finite")
	}
	if config.Max != nil && (math.IsNaN(*config.Max) || math.IsInf(*config.Max, 0)) {
		return nil, errors.New("sonicws: maximum must be finite")
	}
	if config.Min != nil && config.Max != nil && *config.Min > *config.Max {
		return nil, errors.New("sonicws: minimum exceeds maximum")
	}
	if config.Rereference && fields[0].Min == 0 {
		return nil, errors.New("sonicws: rereference requires at least one value")
	}
	if config.Replay && config.BatchMillis != 0 {
		return nil, errors.New("sonicws: replay and batching cannot be combined")
	}
	if config.Rereference && config.BatchMillis != 0 {
		return nil, errors.New("sonicws: rereference and batching cannot be combined")
	}
	maxBatch := config.MaxBatch
	if maxBatch == 0 {
		maxBatch = 10
	}
	if maxBatch < 0 {
		return nil, errors.New("sonicws: batch limit cannot be negative")
	}
	return &Packet{
		tag: config.Tag, fields: fields, object: config.Object,
		schema: append([]string(nil), config.Schema...), quantized: clone(config.Quantized),
		valueMin: clone(config.Min), valueMax: clone(config.Max), group: clone(config.Group),
		constructor: config.Constructor, replay: config.Replay, dontSpread: config.DontSpread,
		async: config.Async, autoFlatten: config.AutoFlatten, rereference: config.Rereference,
		compress:    config.Compress,
		batchMillis: config.BatchMillis, maxBatch: maxBatch,
		residual: make(map[uint64][]float64),
	}, nil
}

// NewValuePacket builds a packet containing exactly one value.
func NewValuePacket(tag string, kind Type) (*Packet, error) {
	return NewPacket(PacketConfig{Tag: tag, Fields: []Field{{Type: kind}}})
}

// Tag returns the packet's negotiated name.
func (p *Packet) Tag() string { return p.tag }

// Replay reports whether server sends are retained for recovery.
func (p *Packet) Replay() bool { return p.replay }

// Rereference reports whether identical sends may omit their payload.
func (p *Packet) Rereference() bool { return p.rereference }

// Batched reports whether the packet carries framed payloads.
func (p *Packet) Batched() bool { return p.batchMillis != 0 }

// Schema returns a copy of the application field names.
func (p *Packet) Schema() []string { return append([]string(nil), p.schema...) }

// Encode converts application values to a packet payload.
func (p *Packet) Encode(values ...any) ([]byte, error) {
	return p.encodeFor(0, values)
}

func (p *Packet) encodeFor(connection uint64, values []any) (data []byte, err error) {
	previous, existed := p.residualState(connection)
	defer func() {
		if err != nil {
			p.restoreResidual(connection, previous, existed)
		}
	}()
	values, err = p.prepare(values, connection)
	if err != nil {
		return nil, fmt.Errorf("sonicws: encode %q: %w", p.tag, err)
	}
	data, err = p.encode(values)
	if err != nil {
		return nil, fmt.Errorf("sonicws: encode %q: %w", p.tag, err)
	}
	if p.compress && !p.object && !p.Batched() {
		data, err = core.Deflate(data)
	}
	return data, err
}

// Decode validates and converts a packet payload.
func (p *Packet) Decode(data []byte) ([]any, error) {
	if p.compress && !p.object && !p.Batched() {
		var err error
		data, err = core.Inflate(data)
		if err != nil {
			return nil, fmt.Errorf("sonicws: decode %q compression: %w", p.tag, err)
		}
	}
	values, err := p.decode(data)
	if err == nil {
		values, err = p.finish(values)
	}
	if err != nil {
		return nil, fmt.Errorf("sonicws: decode %q: %w", p.tag, err)
	}
	return values, nil
}

// EncodeBatch combines values for a packet configured for batching.
func (p *Packet) EncodeBatch(items ...[]any) ([]byte, error) {
	return p.encodeBatchFor(0, items)
}

func (p *Packet) encodeBatchFor(connection uint64, items [][]any) ([]byte, error) {
	if !p.Batched() {
		return nil, errors.New("sonicws: packet is not batched")
	}
	if p.maxBatch > 0 && len(items) > p.maxBatch {
		return nil, errors.New("sonicws: batch exceeds item limit")
	}
	parts := make([][]byte, len(items))
	for n := range items {
		values, err := p.prepare(items[n], connection)
		if err != nil {
			return nil, err
		}
		parts[n], err = p.encode(values)
		if err != nil {
			return nil, err
		}
	}
	return core.EncodeBatch(parts, p.compress)
}

// DecodeBatch validates and expands a batched payload.
func (p *Packet) DecodeBatch(data []byte) ([][]any, error) {
	if !p.Batched() {
		return nil, errors.New("sonicws: packet is not batched")
	}
	parts, err := core.DecodeBatch(data, p.compress, p.maxBatch)
	if err != nil {
		return nil, err
	}
	out := make([][]any, len(parts))
	for n := range parts {
		out[n], err = p.decode(parts[n])
		if err == nil {
			out[n], err = p.finish(out[n])
		}
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
