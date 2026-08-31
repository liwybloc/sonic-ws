package sonicws

import (
	"errors"
	"fmt"
	"math"

	"github.com/liwybloc/sonic-ws/projects/go/internal/core"
)

func (p *Packet) encode(values []any) ([]byte, error) {
	if p.object {
		if len(values) != len(p.fields) {
			return nil, errors.New("object field count mismatch")
		}
		parts := make([][]byte, len(values))
		for n, field := range p.fields {
			var err error
			if field.Type == JSON {
				count := 1
				if list, ok := values[n].([]any); ok {
					count = len(list)
				}
				if count < int(field.Min) || count > int(field.Max) {
					return nil, fmt.Errorf("field %d: value count outside packet range", n)
				}
				parts[n], err = encodeJSON(values[n])
			} else {
				parts[n], err = encodeField(field, asList(values[n]))
			}
			if err != nil {
				return nil, fmt.Errorf("field %d: %w", n, err)
			}
		}
		return core.Frame(parts)
	}
	return encodeField(p.fields[0], values)
}

func (p *Packet) decode(data []byte) ([]any, error) {
	if p.object {
		parts, err := core.Unframe(data, len(p.fields))
		if err != nil || len(parts) != len(p.fields) {
			return nil, errors.New("object field count mismatch")
		}
		out := make([]any, len(parts))
		for n, field := range p.fields {
			if field.Type == JSON {
				out[n], err = decodeJSON(parts[n])
				if err != nil {
					return nil, fmt.Errorf("field %d: %w", n, err)
				}
				count := 1
				if list, ok := out[n].([]any); ok {
					count = len(list)
				}
				if count < int(field.Min) || count > int(field.Max) {
					return nil, fmt.Errorf("field %d: value count outside packet range", n)
				}
				continue
			}
			values, err := decodeField(field, parts[n])
			if err != nil {
				return nil, fmt.Errorf("field %d: %w", n, err)
			}
			if len(values) == 1 && !p.autoFlatten {
				out[n] = values[0]
			} else {
				out[n] = values
			}
		}
		return out, nil
	}
	return decodeField(p.fields[0], data)
}

func encodeField(field Field, values []any) ([]byte, error) {
	if field.Type != Raw && field.Type != Hex && (len(values) < int(field.Min) || len(values) > int(field.Max)) {
		return nil, errors.New("value count outside packet range")
	}
	switch field.Type {
	case None:
		if len(values) != 0 {
			return nil, errors.New("NONE takes no values")
		}
		return []byte{}, nil
	case Raw:
		if len(values) != 1 {
			return nil, errors.New("RAW takes one []byte")
		}
		data, ok := values[0].([]byte)
		if !ok {
			return nil, errors.New("RAW takes one []byte")
		}
		return append([]byte(nil), data...), nil
	case JSON:
		return encodeJSON(values)
	case Bytes, Shorts, VarInt, Deltas:
		numbers, err := signed(values)
		if err != nil {
			return nil, err
		}
		if field.Type == VarInt || field.Type == Deltas {
			for _, value := range numbers {
				if value < math.MinInt32 || value > math.MaxInt32 {
					return nil, errors.New("VARINT and DELTAS use signed 32-bit values")
				}
			}
		}
		return core.EncodeSigned(byte(field.Type), numbers)
	case UBytes, UShorts, UVarInt:
		numbers, err := unsigned(values)
		if err != nil {
			return nil, err
		}
		if field.Type == UVarInt {
			for _, value := range numbers {
				if value > math.MaxUint32 {
					return nil, errors.New("UVARINT uses unsigned 32-bit values")
				}
			}
		}
		return core.EncodeUnsigned(byte(field.Type), numbers)
	case Floats, Doubles:
		numbers, err := floats(values)
		if err != nil {
			return nil, err
		}
		return core.EncodeFloats(byte(field.Type), numbers)
	case ASCII, UTF16:
		strings := make([]string, len(values))
		for n, value := range values {
			var ok bool
			strings[n], ok = value.(string)
			if !ok {
				return nil, errors.New("string packet requires strings")
			}
		}
		return core.EncodeStrings(byte(field.Type), strings)
	case Bools:
		bools := make([]bool, len(values))
		for n, value := range values {
			var ok bool
			bools[n], ok = value.(bool)
			if !ok {
				return nil, errors.New("boolean packet requires bools")
			}
		}
		return core.EncodeBools(bools)
	case Hex:
		if len(values) != 1 {
			return nil, errors.New("HEX takes one string")
		}
		value, ok := values[0].(string)
		if !ok {
			return nil, errors.New("HEX takes one string")
		}
		return core.EncodeHex(value)
	case Enums:
		out := make([]byte, len(values))
		for n, value := range values {
			index := enumIndex(field.Enum, value)
			if index < 0 {
				return nil, fmt.Errorf("value %v is not in enum %q", value, field.Enum.Name)
			}
			out[n] = byte(index)
		}
		return out, nil
	}
	return nil, errors.New("unknown packet type")
}

func decodeField(field Field, data []byte) ([]any, error) {
	if field.Type != Enums && field.Type != JSON && field.Type != Raw && field.Type != Hex {
		if err := core.Validate(byte(field.Type), data, uint64(field.Min), uint64(field.Max), false); err != nil {
			return nil, err
		}
	}
	switch field.Type {
	case None:
		if len(data) != 0 {
			return nil, errors.New("NONE contains data")
		}
		return nil, nil
	case Raw:
		return []any{append([]byte(nil), data...)}, nil
	case JSON:
		value, err := decodeJSON(data)
		if err != nil {
			return nil, err
		}
		if values, ok := value.([]any); ok {
			if len(values) < int(field.Min) || len(values) > int(field.Max) {
				return nil, errors.New("value count outside packet range")
			}
			return values, nil
		}
		if field.Min > 1 || field.Max < 1 {
			return nil, errors.New("value count outside packet range")
		}
		return []any{value}, nil
	case Bytes, Shorts, VarInt, Deltas:
		values, err := core.DecodeSigned(byte(field.Type), data, uint64(field.Max))
		if err == nil && (field.Type == VarInt || field.Type == Deltas) {
			for _, value := range values {
				if value < math.MinInt32 || value > math.MaxInt32 {
					return nil, errors.New("decoded signed integer exceeds 32 bits")
				}
			}
		}
		return anySlice(values), err
	case UBytes, UShorts, UVarInt:
		values, err := core.DecodeUnsigned(byte(field.Type), data, uint64(field.Max))
		if err == nil && field.Type == UVarInt {
			for _, value := range values {
				if value > math.MaxUint32 {
					return nil, errors.New("decoded unsigned integer exceeds 32 bits")
				}
			}
		}
		return anySlice(values), err
	case Floats, Doubles:
		values, err := core.DecodeFloats(byte(field.Type), data, uint64(field.Max))
		return anySlice(values), err
	case ASCII, UTF16:
		values, err := core.DecodeStrings(byte(field.Type), data, uint64(field.Max))
		return anySlice(values), err
	case Bools:
		values, err := core.DecodeBools(data, uint64(field.Max))
		if err != nil || len(values) < int(field.Min) {
			return nil, errors.New("invalid boolean payload")
		}
		return anySlice(values), nil
	case Hex:
		value, err := core.DecodeHex(data)
		return []any{value}, err
	case Enums:
		if len(data) < int(field.Min) || len(data) > int(field.Max) {
			return nil, errors.New("enum count outside packet range")
		}
		out := make([]any, len(data))
		for n, index := range data {
			if int(index) >= len(field.Enum.Values) {
				return nil, errors.New("enum index out of range")
			}
			out[n] = field.Enum.Values[index]
		}
		return out, nil
	}
	return nil, errors.New("unknown packet type")
}

func validateEnum(value *Enum) error {
	if value == nil || value.Name == "" || len(value.Values) > 255 {
		return errors.New("sonicws: invalid enum")
	}
	if _, err := latin1(value.Name); err != nil {
		return err
	}
	for _, item := range value.Values {
		_, text, err := enumText(item)
		if err != nil {
			return err
		}
		if _, err := latin1(text); err != nil {
			return err
		}
	}
	return nil
}

func enumIndex(enum *Enum, value any) int {
	for n, item := range enum.Values {
		if left, ok := number(item); ok {
			right, numeric := number(value)
			if numeric && left == right {
				return n
			}
			continue
		}
		switch item := item.(type) {
		case string:
			if value, ok := value.(string); ok && item == value {
				return n
			}
		case bool:
			if value, ok := value.(bool); ok && item == value {
				return n
			}
		case nil:
			if value == nil {
				return n
			}
		case Undefined:
			if _, ok := value.(Undefined); ok {
				return n
			}
		}
	}
	return -1
}

func signed(values []any) ([]int64, error) {
	out := make([]int64, len(values))
	for n, value := range values {
		switch value := value.(type) {
		case int:
			out[n] = int64(value)
		case int64:
			out[n] = value
		default:
			return nil, fmt.Errorf("%v is not a signed integer", value)
		}
	}
	return out, nil
}

func unsigned(values []any) ([]uint64, error) {
	out := make([]uint64, len(values))
	for n, value := range values {
		switch value := value.(type) {
		case uint:
			out[n] = uint64(value)
		case uint64:
			out[n] = value
		case int:
			if value < 0 {
				return nil, errors.New("unsigned integer is negative")
			}
			out[n] = uint64(value)
		case int64:
			if value < 0 {
				return nil, errors.New("unsigned integer is negative")
			}
			out[n] = uint64(value)
		default:
			return nil, fmt.Errorf("%v is not an unsigned integer", value)
		}
	}
	return out, nil
}

func floats(values []any) ([]float64, error) {
	out := make([]float64, len(values))
	for n, value := range values {
		switch value := value.(type) {
		case float64:
			out[n] = value
		case float32:
			out[n] = float64(value)
		case int:
			out[n] = float64(value)
		case int64:
			out[n] = float64(value)
		default:
			return nil, fmt.Errorf("%v is not numeric", value)
		}
	}
	return out, nil
}

func asList(value any) []any {
	if values, ok := value.([]any); ok {
		return values
	}
	return []any{value}
}

func anySlice[T any](values []T) []any {
	out := make([]any, len(values))
	for n := range values {
		out[n] = values[n]
	}
	return out
}

func clone[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
