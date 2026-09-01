package sonicws

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Registry maps ordered packet definitions to one-byte wire keys.
type Registry struct {
	packets []*Packet
	keys    map[string]byte
}

// NewRegistry validates an ordered packet table.
func NewRegistry(packets ...*Packet) (*Registry, error) {
	if len(packets) > 254 {
		return nil, errors.New("sonicws: a registry supports at most 254 packets")
	}
	r := &Registry{packets: append([]*Packet(nil), packets...), keys: make(map[string]byte, len(packets))}
	for n, packet := range packets {
		if packet == nil {
			return nil, errors.New("sonicws: registry contains a nil packet")
		}
		if _, exists := r.keys[packet.tag]; exists {
			return nil, fmt.Errorf("sonicws: duplicate packet %q", packet.tag)
		}
		r.keys[packet.tag] = byte(n + 1)
	}
	return r, nil
}

// Len returns the number of packets.
func (r *Registry) Len() int { return len(r.packets) }

// Packet looks up a packet by tag.
func (r *Registry) Packet(tag string) (*Packet, bool) {
	key, ok := r.keys[tag]
	if !ok {
		return nil, false
	}
	return r.packets[key-1], true
}

// ByKey looks up a packet by its one-based wire key.
func (r *Registry) ByKey(key byte) (*Packet, bool) {
	if key == 0 || int(key) > len(r.packets) {
		return nil, false
	}
	return r.packets[key-1], true
}

// Key returns a packet's one-based wire key.
func (r *Registry) Key(tag string) (byte, bool) {
	key, ok := r.keys[tag]
	return key, ok
}

type packetMetadata struct {
	Schema      []string      `json:"schema,omitempty"`
	Quantized   *Quantization `json:"quantized,omitempty"`
	Min         *float64      `json:"min,omitempty"`
	Max         *float64      `json:"max,omitempty"`
	Group       *Group        `json:"group,omitempty"`
	Constructor string        `json:"constructor,omitempty"`
	Replay      bool          `json:"replay,omitempty"`
}

// MarshalBinary encodes the packet table used during negotiation.
func (r *Registry) MarshalBinary() ([]byte, error) {
	if r == nil {
		return nil, errors.New("sonicws: registry is nil")
	}
	var out []byte
	for _, packet := range r.packets {
		data, err := marshalPacket(packet)
		if err != nil {
			return nil, err
		}
		out = append(out, data...)
	}
	return out, nil
}

// ParseRegistry validates and decodes a negotiated packet table.
func ParseRegistry(data []byte) (*Registry, error) {
	c := cursor{data: data}
	var packets []*Packet
	for !c.empty() {
		if len(packets) == 254 {
			return nil, protocolf("too many packets")
		}
		packet, err := parsePacket(&c)
		if err != nil {
			return nil, err
		}
		packets = append(packets, packet)
	}
	return NewRegistry(packets...)
}

func marshalPacket(p *Packet) ([]byte, error) {
	var out []byte
	var err error
	out, err = putText(out, p.tag)
	if err != nil {
		return nil, err
	}
	flags := byte(0)
	if p.dontSpread {
		flags |= 0x80
	}
	if p.async {
		flags |= 0x40
	}
	if p.object {
		flags |= 0x20
	}
	if p.autoFlatten {
		flags |= 0x10
	}
	if p.compress {
		flags |= 0x08
	}
	if p.rereference {
		flags |= 0x04
	}
	out = append(out, flags)
	metadata, err := json.Marshal(packetMetadata{
		Schema: p.schema, Quantized: p.quantized, Min: p.valueMin, Max: p.valueMax,
		Group: p.group, Constructor: p.constructor, Replay: p.replay,
	})
	if err != nil {
		return nil, err
	}
	out = putVarint(out, uint64(len(metadata)))
	out = append(out, metadata...)
	out = append(out, p.batchMillis)
	enums := packetEnums(p)
	if len(enums) > 255 {
		return nil, errors.New("sonicws: too many packet enums")
	}
	out = append(out, byte(len(enums)))
	for _, enum := range enums {
		out, err = marshalEnum(out, enum)
		if err != nil {
			return nil, err
		}
	}
	if !p.object {
		field := p.fields[0]
		out = putVarint(out, uint64(field.Max))
		out = putVarint(out, uint64(field.Min))
		return append(out, byte(field.Type)), nil
	}
	out = append(out, byte(len(p.fields)))
	for _, field := range p.fields {
		out = putVarint(out, uint64(field.Max))
	}
	for _, field := range p.fields {
		out = putVarint(out, uint64(field.Min))
	}
	for _, field := range p.fields {
		out = append(out, byte(field.Type))
	}
	return out, nil
}

func parsePacket(c *cursor) (*Packet, error) {
	tag, err := readText(c)
	if err != nil {
		return nil, err
	}
	flags, err := c.byte()
	if err != nil {
		return nil, err
	}
	if flags&0x03 != 0 {
		return nil, protocolf("packet uses reserved flags")
	}
	metadataSize, err := c.size()
	if err != nil {
		return nil, err
	}
	metadataData, err := c.take(metadataSize)
	if err != nil {
		return nil, err
	}
	var metadata packetMetadata
	if err := json.Unmarshal(metadataData, &metadata); err != nil {
		return nil, protocolf("invalid packet metadata: %v", err)
	}
	batch, err := c.byte()
	if err != nil {
		return nil, err
	}
	enumCount, err := c.byte()
	if err != nil {
		return nil, err
	}
	enums := make([]*Enum, int(enumCount))
	for n := range enums {
		enums[n], err = parseEnum(c)
		if err != nil {
			return nil, err
		}
	}
	object := flags&0x20 != 0
	count := 1
	if object {
		value, err := c.byte()
		if err != nil {
			return nil, err
		}
		count = int(value)
		if count == 0 {
			return nil, protocolf("object packet has no fields")
		}
	}
	maxes := make([]uint32, count)
	mins := make([]uint32, count)
	for n := range maxes {
		value, err := c.varint()
		if err != nil || value > MaxValues {
			return nil, protocolf("invalid packet maximum")
		}
		maxes[n] = uint32(value)
	}
	for n := range mins {
		value, err := c.varint()
		if err != nil || value > uint64(maxes[n]) {
			return nil, protocolf("invalid packet minimum")
		}
		mins[n] = uint32(value)
	}
	fields := make([]Field, count)
	enumIndex := 0
	for n := range fields {
		kind, err := c.byte()
		if err != nil || !validType(Type(kind)) {
			return nil, protocolf("invalid packet type %d", kind)
		}
		fields[n] = Field{Type: Type(kind), Min: mins[n], Max: maxes[n]}
		if fields[n].Type == Enums {
			if enumIndex == len(enums) {
				return nil, protocolf("missing enum definition")
			}
			fields[n].Enum = enums[enumIndex]
			enumIndex++
		}
	}
	if enumIndex != len(enums) {
		return nil, protocolf("unused enum definition")
	}
	packet, err := NewPacket(PacketConfig{
		Tag: tag, Fields: fields, Object: object, Schema: metadata.Schema,
		Quantized: metadata.Quantized, Min: metadata.Min, Max: metadata.Max,
		Group: metadata.Group, Constructor: metadata.Constructor, Replay: metadata.Replay,
		DontSpread: flags&0x80 != 0, Async: flags&0x40 != 0, AutoFlatten: flags&0x10 != 0,
		Rereference: flags&0x04 != 0, Compress: flags&0x08 != 0,
		BatchMillis: batch,
	})
	if err != nil {
		return nil, protocolf("invalid packet %q: %v", tag, err)
	}
	return packet, nil
}

func packetEnums(packet *Packet) []*Enum {
	var out []*Enum
	for _, field := range packet.fields {
		if field.Type == Enums {
			out = append(out, field.Enum)
		}
	}
	return out
}

func marshalEnum(out []byte, enum *Enum) ([]byte, error) {
	var err error
	out, err = putText(out, enum.Name)
	if err != nil {
		return nil, err
	}
	out = append(out, byte(len(enum.Values)))
	for _, value := range enum.Values {
		kind, text, err := enumText(value)
		if err != nil {
			return nil, err
		}
		encoded, err := latin1(text)
		if err != nil {
			return nil, err
		}
		out = append(out, byte(len(encoded)), kind)
		out = append(out, encoded...)
	}
	return out, nil
}

func parseEnum(c *cursor) (*Enum, error) {
	name, err := readText(c)
	if err != nil {
		return nil, err
	}
	count, err := c.byte()
	if err != nil {
		return nil, err
	}
	values := make([]any, int(count))
	for n := range values {
		size, err := c.byte()
		if err != nil {
			return nil, err
		}
		kind, err := c.byte()
		if err != nil {
			return nil, err
		}
		data, err := c.take(int(size))
		if err != nil {
			return nil, err
		}
		text := latin1String(data)
		switch kind {
		case 0:
			values[n] = text
		case 1:
			if strings.ContainsAny(text, ".eE") {
				value, err := strconv.ParseFloat(text, 64)
				if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
					return nil, protocolf("invalid enum number")
				}
				values[n] = value
			} else {
				value, err := strconv.ParseInt(text, 10, 64)
				if err != nil {
					return nil, protocolf("invalid enum number")
				}
				values[n] = value
			}
		case 2:
			if text != "true" && text != "false" {
				return nil, protocolf("invalid enum boolean")
			}
			values[n] = text == "true"
		case 3:
			values[n] = Undefined{}
		case 4:
			values[n] = nil
		default:
			return nil, protocolf("invalid enum value type %d", kind)
		}
	}
	enum := &Enum{Name: name, Values: values}
	if err := validateEnum(enum); err != nil {
		return nil, protocolf("invalid enum: %v", err)
	}
	return enum, nil
}

func enumText(value any) (byte, string, error) {
	switch value := value.(type) {
	case string:
		return 0, value, nil
	case int:
		return 1, strconv.Itoa(value), nil
	case int64:
		return 1, strconv.FormatInt(value, 10), nil
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, "", errors.New("sonicws: enum number must be finite")
		}
		return 1, strconv.FormatFloat(value, 'g', -1, 64), nil
	case bool:
		return 2, strconv.FormatBool(value), nil
	case Undefined:
		return 3, "undefined", nil
	case nil:
		return 4, "null", nil
	default:
		return 0, "", fmt.Errorf("sonicws: unsupported enum value %T", value)
	}
}

// CreateManifest encodes both packet directions for offline use.
func CreateManifest(client, server *Registry) ([]byte, error) {
	if client == nil || server == nil {
		return nil, errors.New("sonicws: manifest registries cannot be nil")
	}
	clients, err := client.MarshalBinary()
	if err != nil {
		return nil, err
	}
	servers, err := server.MarshalBinary()
	if err != nil {
		return nil, err
	}
	out := append([]byte("SWSM"), Version)
	out = putVarint(out, uint64(len(clients)))
	out = append(out, clients...)
	return append(out, servers...), nil
}

// ParseManifest decodes an offline packet manifest.
func ParseManifest(data []byte) (*Registry, *Registry, error) {
	if len(data) < 5 || string(data[:4]) != "SWSM" || data[4] != Version {
		return nil, nil, protocolf("invalid packet manifest")
	}
	c := cursor{data: data[5:]}
	size, err := c.size()
	if err != nil {
		return nil, nil, err
	}
	clients, err := c.take(size)
	if err != nil {
		return nil, nil, err
	}
	client, err := ParseRegistry(clients)
	if err != nil {
		return nil, nil, err
	}
	server, err := ParseRegistry(c.rest())
	return client, server, err
}
