package sonicws

import (
	"encoding/hex"
	"encoding/json"
	"math"
	"math/rand"
	"os"
	"sync"
	"testing"
)

type goldenFile struct {
	ProtocolVersion byte `json:"protocolVersion"`
	Vectors         []struct {
		Name        string         `json:"name"`
		Type        string         `json:"type"`
		Values      any            `json:"values"`
		Hex         string         `json:"hex"`
		Schema      []string       `json:"schema"`
		AutoFlatten bool           `json:"autoFlatten"`
		Quantized   map[string]any `json:"quantized"`
	} `json:"vectors"`
}

func TestGoldenVectors(t *testing.T) {
	data, err := os.ReadFile("../../protocol/golden-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var file goldenFile
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	if file.ProtocolVersion != Version {
		t.Fatalf("protocol version is %d", file.ProtocolVersion)
	}
	for _, vector := range file.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			kind := typeNames[vector.Type]
			values := normalizeGolden(vector.Values, kind)
			config := PacketConfig{Tag: vector.Name, Fields: []Field{{Type: kind, Min: uint32(len(values)), Max: uint32(len(values))}}, Schema: vector.Schema, AutoFlatten: vector.AutoFlatten}
			if vector.Quantized != nil {
				config.Quantized = &Quantization{Scale: vector.Quantized["scale"].(float64), DisableErrorTracking: !vector.Quantized["trackError"].(bool)}
				config.Fields[0].Min = uint32(len(vector.Schema))
				if vector.AutoFlatten {
					config.Fields[0].Min *= uint32(len(vector.Values.([]any)))
				}
				config.Fields[0].Max = config.Fields[0].Min
			}
			packet, err := NewPacket(config)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := packet.Encode(values...)
			if err != nil {
				t.Fatal(err)
			}
			if hex.EncodeToString(encoded) != vector.Hex {
				t.Fatalf("got %x, want %s", encoded, vector.Hex)
			}
			if _, err := packet.Decode(encoded); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPacketModes(t *testing.T) {
	enum := &Enum{Name: "status", Values: []any{"idle", "run", true, nil, Undefined{}}}
	packets := []struct {
		config PacketConfig
		values []any
	}{
		{PacketConfig{Tag: "none", Fields: []Field{{Type: None}}}, nil},
		{PacketConfig{Tag: "raw", Fields: []Field{{Type: Raw}}}, []any{[]byte{1, 2, 3}}},
		{PacketConfig{Tag: "json", Fields: []Field{{Type: JSON, Min: 1, Max: 1}}}, []any{map[string]any{"ok": true}}},
		{PacketConfig{Tag: "enum", Fields: []Field{{Type: Enums, Min: 2, Max: 2, Enum: enum}}}, []any{"run", true}},
		{PacketConfig{Tag: "doubles", Fields: []Field{{Type: Doubles, Min: 1, Max: 1}}}, []any{math.Inf(1)}},
		{PacketConfig{Tag: "compressed", Compress: true, Fields: []Field{{Type: VarInt, Min: 2, Max: 2}}}, []any{int64(1), int64(2)}},
		{PacketConfig{Tag: "object", Object: true, Fields: []Field{{Type: UTF16}, {Type: VarInt}}}, []any{"point", int64(4)}},
	}
	for _, test := range packets {
		packet, err := NewPacket(test.config)
		if err != nil {
			t.Fatal(err)
		}
		data, err := packet.Encode(test.values...)
		if err != nil {
			t.Fatalf("%s: %v", test.config.Tag, err)
		}
		if _, err := packet.Decode(data); err != nil {
			t.Fatalf("%s: %v", test.config.Tag, err)
		}
	}

	batch, err := NewPacket(PacketConfig{Tag: "batch", BatchMillis: 1, Compress: true, MaxBatch: 2, Fields: []Field{{Type: VarInt}}})
	if err != nil {
		t.Fatal(err)
	}
	data, err := batch.EncodeBatch([]any{int64(1)}, []any{int64(2)})
	if err != nil {
		t.Fatal(err)
	}
	values, err := batch.DecodeBatch(data)
	if err != nil || values[1][0] != int64(2) {
		t.Fatalf("unexpected batch: %#v, %v", values, err)
	}
}

func TestRegistryRoundTrip(t *testing.T) {
	packet, err := NewPacket(PacketConfig{Tag: "move", Fields: []Field{{Type: VarInt, Min: 2, Max: 2}}, Schema: []string{"x", "y"}, Replay: true})
	if err != nil {
		t.Fatal(err)
	}
	registry, _ := NewRegistry(packet)
	data, err := registry.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := ParseRegistry(data)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := decoded.Packet("move")
	if !ok || !got.Replay() || len(got.Schema()) != 2 {
		t.Fatal("registry metadata did not round trip")
	}
}

func TestCodecConcurrent(t *testing.T) {
	packet, _ := NewPacket(PacketConfig{Tag: "n", Fields: []Field{{Type: VarInt, Min: 1, Max: 1}}})
	var group sync.WaitGroup
	for n := range 32 {
		group.Add(1)
		go func() {
			defer group.Done()
			data, err := packet.Encode(n)
			if err != nil {
				t.Error(err)
				return
			}
			if _, err := packet.Decode(data); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
}

func TestCompactJSON(t *testing.T) {
	value := map[string]any{"name": "sonic", "ok": true, "values": []any{nil, int64(-12), 1.5}}
	data, err := encodeJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeJSON(data); err != nil {
		t.Fatal(err)
	}
	for _, data := range [][]byte{{}, {0, 1, 0x20}, {0, 1, 0xa0, 0xff, 0xff, 0xff, 0xff, 0x7f}} {
		if _, err := decodeJSON(data); err == nil {
			t.Fatalf("accepted %x", data)
		}
	}
}

func TestMalformedSchemasDoNotPanic(t *testing.T) {
	random := rand.New(rand.NewSource(1))
	for range 1000 {
		data := make([]byte, random.Intn(128))
		_, _ = random.Read(data)
		_, _ = ParseRegistry(data)
	}
}

func TestAutoTranspose(t *testing.T) {
	packet, err := NewPacket(PacketConfig{
		Tag: "points", Object: true, AutoFlatten: true, Schema: []string{"x", "y"},
		Fields: []Field{{Type: VarInt, Min: 2, Max: 2}, {Type: VarInt, Min: 2, Max: 2}},
	})
	if err != nil {
		t.Fatal(err)
	}
	rows := []any{map[string]any{"x": int64(1), "y": int64(2)}, map[string]any{"x": int64(3), "y": int64(4)}}
	data, err := packet.Encode(rows)
	if err != nil {
		t.Fatal(err)
	}
	values, err := packet.Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 1 || len(values[0].([]any)) != 2 {
		t.Fatalf("unexpected rows: %#v", values)
	}
}

func normalizeGolden(value any, kind Type) []any {
	if values, ok := value.([]any); ok {
		if len(values) > 0 {
			if _, records := values[0].(map[string]any); records {
				return []any{values}
			}
		}
		out := make([]any, len(values))
		for n, value := range values {
			if number, ok := value.(float64); ok {
				switch kind {
				case UBytes, UShorts, UVarInt:
					out[n] = uint64(number)
				case Bytes, Shorts, VarInt, Deltas:
					out[n] = int64(number)
				default:
					out[n] = number
				}
			} else {
				out[n] = value
			}
		}
		return out
	}
	return []any{value}
}

var typeNames = map[string]Type{
	"BYTES": Bytes, "UBYTES": UBytes, "SHORTS": Shorts, "USHORTS": UShorts,
	"VARINT": VarInt, "UVARINT": UVarInt, "DELTAS": Deltas, "FLOATS": Floats,
	"DOUBLES": Doubles, "STRINGS_ASCII": ASCII, "STRINGS_UTF16": UTF16,
	"BOOLEANS": Bools, "HEX": Hex,
}
