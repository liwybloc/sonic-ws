package sonicws

import (
	"errors"
	"math"
	"sort"
	"unicode/utf8"
)

const maxJSONDepth = 100

func encodeJSON(value any) ([]byte, error) {
	var bools []bool
	var types []byte
	var payload []byte

	var encode func(any, int) error
	encode = func(value any, depth int) error {
		if depth > maxJSONDepth {
			return errors.New("compact JSON nesting is too deep")
		}
		switch value := value.(type) {
		case nil:
			types = append(types, 0)
		case bool:
			types = append(types, 1)
			bools = append(bools, value)
		case int8:
			return encode(int(value), depth)
		case int16:
			return encode(int(value), depth)
		case int32:
			return encode(int(value), depth)
		case int:
			if value < math.MinInt32 || value > math.MaxInt32 {
				return errors.New("compact JSON integer exceeds int32")
			}
			types = append(types, 2)
			payload = putVarint(payload, uint64(uint32(int32(value)<<1)^uint32(int32(value)>>31)))
		case int64:
			if value < math.MinInt32 || value > math.MaxInt32 {
				return errors.New("compact JSON integer exceeds int32")
			}
			return encode(int(value), depth)
		case uint8:
			return encode(int(value), depth)
		case uint16:
			return encode(int(value), depth)
		case uint32:
			if value > math.MaxInt32 {
				return errors.New("compact JSON integer exceeds int32")
			}
			return encode(int(value), depth)
		case uint:
			if uint64(value) > math.MaxInt32 {
				return errors.New("compact JSON integer exceeds int32")
			}
			return encode(int(value), depth)
		case uint64:
			if value > math.MaxInt32 {
				return errors.New("compact JSON integer exceeds int32")
			}
			return encode(int(value), depth)
		case float32:
			return encode(float64(value), depth)
		case float64:
			converted := float32(value)
			if math.IsNaN(value) || math.IsInf(value, 0) || math.IsInf(float64(converted), 0) {
				return errors.New("compact JSON number must be finite")
			}
			types = append(types, 3)
			bits := math.Float32bits(converted)
			payload = append(payload, byte(bits>>24), byte(bits>>16), byte(bits>>8), byte(bits))
		case string:
			if !utf8.ValidString(value) {
				return errors.New("compact JSON string is not UTF-8")
			}
			types = append(types, 4)
			payload = putVarint(payload, uint64(len(value)))
			payload = append(payload, value...)
		case []any:
			types = append(types, 5)
			payload = putVarint(payload, uint64(len(value)))
			for _, item := range value {
				if err := encode(item, depth+1); err != nil {
					return err
				}
			}
		case map[string]any:
			types = append(types, 6)
			payload = putVarint(payload, uint64(len(value)))
			keys := make([]string, 0, len(value))
			for key := range value {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				if !utf8.ValidString(key) {
					return errors.New("compact JSON key is not UTF-8")
				}
				payload = putVarint(payload, uint64(len(key)))
				payload = append(payload, key...)
				if err := encode(value[key], depth+1); err != nil {
					return err
				}
			}
		default:
			return errors.New("unsupported compact JSON value")
		}
		return nil
	}
	if err := encode(value, 0); err != nil {
		return nil, err
	}
	boolBytes := make([]byte, (len(bools)+7)/8)
	for n, value := range bools {
		if value {
			boolBytes[n/8] |= 1 << (7 - n%8)
		}
	}
	typeBytes := make([]byte, (len(types)*3+7)/8)
	bit := 0
	for _, kind := range types {
		for shift := 2; shift >= 0; shift-- {
			if kind&(1<<shift) != 0 {
				typeBytes[bit/8] |= 1 << (7 - bit%8)
			}
			bit++
		}
	}
	out := putVarint(nil, uint64(len(boolBytes)))
	out = putVarint(out, uint64(len(typeBytes)))
	out = append(out, boolBytes...)
	out = append(out, typeBytes...)
	return append(out, payload...), nil
}

func decodeJSON(data []byte) (any, error) {
	c := cursor{data: data}
	boolSize, err := c.size()
	if err != nil {
		return nil, err
	}
	typeSize, err := c.size()
	if err != nil {
		return nil, err
	}
	boolBytes, err := c.take(boolSize)
	if err != nil {
		return nil, err
	}
	typeBytes, err := c.take(typeSize)
	if err != nil || len(typeBytes) == 0 {
		return nil, protocolf("invalid compact JSON header")
	}
	typeCount := len(typeBytes) * 8 / 3
	typeAt := func(index int) byte {
		bit := index * 3
		var kind byte
		for range 3 {
			kind <<= 1
			if typeBytes[bit/8]&(1<<(7-bit%8)) != 0 {
				kind++
			}
			bit++
		}
		return kind
	}
	typeIndex, boolIndex := 0, 0
	var decode func(int) (any, error)
	decode = func(depth int) (any, error) {
		if depth > maxJSONDepth || typeIndex >= typeCount {
			return nil, protocolf("invalid compact JSON shape")
		}
		kind := typeAt(typeIndex)
		typeIndex++
		switch kind {
		case 0:
			return nil, nil
		case 1:
			if boolIndex >= len(boolBytes)*8 {
				return nil, protocolf("truncated compact JSON booleans")
			}
			value := boolBytes[boolIndex/8]&(1<<(7-boolIndex%8)) != 0
			boolIndex++
			return value, nil
		case 2:
			raw, err := c.varint()
			if err != nil || raw > math.MaxUint32 {
				return nil, protocolf("invalid compact JSON integer")
			}
			value := int32(raw >> 1)
			if raw&1 != 0 {
				value = ^value
			}
			return int64(value), nil
		case 3:
			raw, err := c.take(4)
			if err != nil {
				return nil, err
			}
			bits := uint32(raw[0])<<24 | uint32(raw[1])<<16 | uint32(raw[2])<<8 | uint32(raw[3])
			value := float64(math.Float32frombits(bits))
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return nil, protocolf("non-finite compact JSON number")
			}
			return value, nil
		case 4:
			size, err := c.size()
			if err != nil {
				return nil, err
			}
			raw, err := c.take(size)
			if err != nil || !utf8.Valid(raw) {
				return nil, protocolf("invalid compact JSON string")
			}
			return string(raw), nil
		case 5:
			size, err := c.size()
			if err != nil || size > typeCount-typeIndex {
				return nil, protocolf("invalid compact JSON array length")
			}
			out := make([]any, size)
			for n := range out {
				out[n], err = decode(depth + 1)
				if err != nil {
					return nil, err
				}
			}
			return out, nil
		case 6:
			size, err := c.size()
			if err != nil || size > typeCount-typeIndex {
				return nil, protocolf("invalid compact JSON object length")
			}
			out := make(map[string]any, size)
			for range size {
				keySize, err := c.size()
				if err != nil {
					return nil, err
				}
				raw, err := c.take(keySize)
				if err != nil {
					return nil, err
				}
				if !utf8.Valid(raw) {
					return nil, protocolf("invalid compact JSON key")
				}
				key := string(raw)
				if _, exists := out[key]; exists {
					return nil, protocolf("duplicate compact JSON key")
				}
				out[key], err = decode(depth + 1)
				if err != nil {
					return nil, err
				}
			}
			return out, nil
		default:
			return nil, protocolf("unknown compact JSON type %d", kind)
		}
	}
	value, err := decode(0)
	if err != nil {
		return nil, err
	}
	if !c.empty() {
		return nil, protocolf("trailing compact JSON data")
	}
	return value, nil
}
