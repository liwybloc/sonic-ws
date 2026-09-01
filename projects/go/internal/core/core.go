package core

import (
	"context"
	_ "embed"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"runtime"
	"sync"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

//go:embed core.wasm
var wasm []byte

const maxOutput = 16 << 20

var shared struct {
	sync.Once
	engine *engine
	err    error
}

type engine struct {
	runtime wazero.Runtime
	pool    chan *instance
}

type instance struct {
	module   api.Module
	memory   api.Memory
	alloc    api.Function
	free     api.Function
	call     api.Function
	validate api.Function
}

func load() (*engine, error) {
	shared.Do(func() {
		ctx := context.Background()
		rt := wazero.NewRuntime(ctx)
		compiled, err := rt.CompileModule(ctx, wasm)
		if err != nil {
			_ = rt.Close(ctx)
			shared.err = fmt.Errorf("compile codec: %w", err)
			return
		}
		n := min(max(runtime.GOMAXPROCS(0), 1), 4)
		e := &engine{runtime: rt, pool: make(chan *instance, n)}
		for range n {
			mod, err := rt.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithName(""))
			if err != nil {
				_ = rt.Close(ctx)
				shared.err = fmt.Errorf("instantiate codec: %w", err)
				return
			}
			i := &instance{
				module:   mod,
				memory:   mod.Memory(),
				alloc:    mod.ExportedFunction("sonic_ws_python_wasm_alloc"),
				free:     mod.ExportedFunction("sonic_ws_python_wasm_free"),
				call:     mod.ExportedFunction("sonic_ws_python_wasm_call"),
				validate: mod.ExportedFunction("sonic_ws_python_validate"),
			}
			if i.memory == nil || i.alloc == nil || i.free == nil || i.call == nil || i.validate == nil {
				_ = rt.Close(ctx)
				shared.err = errors.New("codec has an incompatible ABI")
				return
			}
			e.pool <- i
		}
		shared.engine = e
	})
	return shared.engine, shared.err
}

func use(fn func(*instance) error) error {
	e, err := load()
	if err != nil {
		return err
	}
	i := <-e.pool
	defer func() { e.pool <- i }()
	return fn(i)
}

func (i *instance) input(ctx context.Context, data []byte) (uint32, error) {
	if len(data) == 0 {
		return 0, nil
	}
	if uint64(len(data)) > math.MaxUint32 {
		return 0, errors.New("codec input is too large")
	}
	result, err := i.alloc.Call(ctx, uint64(len(data)))
	if err != nil {
		return 0, err
	}
	ptr := uint32(result[0])
	if !i.memory.Write(ptr, data) {
		_, _ = i.free.Call(ctx, uint64(ptr), uint64(len(data)))
		return 0, errors.New("codec memory write failed")
	}
	return ptr, nil
}

func (i *instance) release(ctx context.Context, ptr uint32, size uint64) {
	if ptr != 0 {
		_, _ = i.free.Call(ctx, uint64(ptr), size)
	}
}

func call(op, kind byte, data []byte, arg uint64) ([]byte, error) {
	var out []byte
	err := use(func(i *instance) error {
		ctx := context.Background()
		ptr, err := i.input(ctx, data)
		if err != nil {
			return err
		}
		result, err := i.call.Call(ctx, uint64(op), uint64(kind), uint64(ptr), uint64(len(data)), arg)
		i.release(ctx, ptr, uint64(len(data)))
		if err != nil {
			return err
		}
		packed := result[0]
		if packed == math.MaxUint64 {
			return errors.New("codec rejected the value")
		}
		ptr, size := uint32(packed), uint32(packed>>32)
		defer i.release(ctx, ptr, uint64(size))
		if size == 0 {
			out = []byte{}
			return nil
		}
		view, ok := i.memory.Read(ptr, size)
		if !ok {
			return errors.New("codec memory read failed")
		}
		out = append([]byte(nil), view...)
		return nil
	})
	return out, err
}

func Validate(kind byte, data []byte, min, max uint64, compressed bool) error {
	return use(func(i *instance) error {
		ctx := context.Background()
		ptr, err := i.input(ctx, data)
		if err != nil {
			return err
		}
		defer i.release(ctx, ptr, uint64(len(data)))
		result, err := i.validate.Call(ctx, uint64(kind), uint64(ptr), uint64(len(data)), min, max, boolArg(compressed))
		if err != nil {
			return err
		}
		if result[0] == 0 {
			return errors.New("invalid packet payload")
		}
		return nil
	})
}

func EncodeSigned(kind byte, values []int64) ([]byte, error) {
	data := make([]byte, len(values)*8)
	for n, value := range values {
		binary.LittleEndian.PutUint64(data[n*8:], uint64(value))
	}
	return call(1, kind, data, 0)
}

func DecodeSigned(kind byte, data []byte, max uint64) ([]int64, error) {
	raw, err := call(2, kind, data, max)
	if err != nil || len(raw)%8 != 0 {
		return nil, codecResult(err)
	}
	out := make([]int64, len(raw)/8)
	for n := range out {
		out[n] = int64(binary.LittleEndian.Uint64(raw[n*8:]))
	}
	return out, nil
}

func EncodeUnsigned(kind byte, values []uint64) ([]byte, error) {
	data := make([]byte, len(values)*8)
	for n, value := range values {
		binary.LittleEndian.PutUint64(data[n*8:], value)
	}
	return call(3, kind, data, 0)
}

func DecodeUnsigned(kind byte, data []byte, max uint64) ([]uint64, error) {
	raw, err := call(4, kind, data, max)
	if err != nil || len(raw)%8 != 0 {
		return nil, codecResult(err)
	}
	out := make([]uint64, len(raw)/8)
	for n := range out {
		out[n] = binary.LittleEndian.Uint64(raw[n*8:])
	}
	return out, nil
}

func EncodeFloats(kind byte, values []float64) ([]byte, error) {
	data := make([]byte, len(values)*8)
	for n, value := range values {
		binary.LittleEndian.PutUint64(data[n*8:], math.Float64bits(value))
	}
	return call(5, kind, data, 0)
}

func DecodeFloats(kind byte, data []byte, max uint64) ([]float64, error) {
	raw, err := call(6, kind, data, max)
	if err != nil || len(raw)%8 != 0 {
		return nil, codecResult(err)
	}
	out := make([]float64, len(raw)/8)
	for n := range out {
		out[n] = math.Float64frombits(binary.LittleEndian.Uint64(raw[n*8:]))
	}
	return out, nil
}

func EncodeStrings(kind byte, values []string) ([]byte, error) {
	parts := make([][]byte, len(values))
	for n := range values {
		parts[n] = []byte(values[n])
	}
	return call(7, kind, frame(parts), 0)
}

func DecodeStrings(kind byte, data []byte, max uint64) ([]string, error) {
	raw, err := call(8, kind, data, max)
	if err != nil {
		return nil, err
	}
	parts, err := unframe(raw, 0)
	if err != nil {
		return nil, err
	}
	out := make([]string, len(parts))
	for n := range parts {
		out[n] = string(parts[n])
	}
	return out, nil
}

func EncodeBools(values []bool) ([]byte, error) {
	data := make([]byte, len(values))
	for n := range values {
		data[n] = boolByte(values[n])
	}
	return call(9, 14, data, 0)
}

func DecodeBools(data []byte, count uint64) ([]bool, error) {
	raw, err := call(10, 14, data, count)
	if err != nil {
		return nil, err
	}
	out := make([]bool, len(raw))
	for n := range raw {
		out[n] = raw[n] != 0
	}
	return out, nil
}

func EncodeHex(value string) ([]byte, error) { return call(12, 17, []byte(value), 0) }
func DecodeHex(data []byte) (string, error) {
	out, err := call(13, 17, data, 0)
	return string(out), err
}

func Frame(parts [][]byte) ([]byte, error) { return frame(parts), nil }
func Unframe(data []byte, limit int) ([][]byte, error) {
	return unframe(data, limit)
}

func EncodeBatch(parts [][]byte, compressed bool) ([]byte, error) {
	return call(16, boolByte(compressed), frame(parts), 0)
}
func DecodeBatch(data []byte, compressed bool, limit int) ([][]byte, error) {
	raw, err := call(17, boolByte(compressed), data, uint64(limit))
	if err != nil {
		return nil, err
	}
	return unframe(raw, limit)
}
func Deflate(data []byte) ([]byte, error) { return call(18, 0, data, 0) }
func Inflate(data []byte) ([]byte, error) { return call(19, 0, data, maxOutput) }

func frame(parts [][]byte) []byte {
	var out []byte
	for _, part := range parts {
		out = appendVarint(out, uint64(len(part)))
		out = append(out, part...)
	}
	return out
}

func unframe(data []byte, limit int) ([][]byte, error) {
	var out [][]byte
	for offset := 0; offset < len(data); {
		next, size, err := readVarint(data, offset)
		if err != nil || size > uint64(len(data)-next) {
			return nil, errors.New("invalid framed payload")
		}
		if limit > 0 && len(out) == limit {
			return nil, errors.New("framed payload exceeds item limit")
		}
		out = append(out, append([]byte(nil), data[next:next+int(size)]...))
		offset = next + int(size)
	}
	return out, nil
}

func appendVarint(out []byte, value uint64) []byte {
	for {
		b := byte(value)
		value >>= 7
		if value != 0 {
			b |= 0x80
		}
		out = append(out, b)
		if value == 0 {
			return out
		}
	}
}

func readVarint(data []byte, offset int) (int, uint64, error) {
	var value uint64
	for shift := uint(0); shift < 64; shift += 7 {
		if offset >= len(data) {
			return 0, 0, errors.New("truncated varint")
		}
		b := data[offset]
		offset++
		if shift == 63 && b > 1 {
			return 0, 0, errors.New("varint overflow")
		}
		value |= uint64(b&0x7f) << shift
		if b&0x80 == 0 {
			return offset, value, nil
		}
	}
	return 0, 0, errors.New("varint overflow")
}

func boolByte(value bool) byte {
	if value {
		return 1
	}
	return 0
}
func boolArg(value bool) uint64 { return uint64(boolByte(value)) }
func codecResult(err error) error {
	if err != nil {
		return err
	}
	return errors.New("codec returned malformed data")
}
