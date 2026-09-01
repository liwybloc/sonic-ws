package sonicws

import (
	"errors"
	"fmt"
	"math"
)

// Version is the supported wire protocol version.
const Version byte = 25

// ErrProtocol identifies malformed or incompatible peer data.
var ErrProtocol = errors.New("sonicws: protocol error")

func protocolf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrProtocol, fmt.Sprintf(format, args...))
}

type cursor struct {
	data []byte
	pos  int
}

func (c *cursor) left() int   { return len(c.data) - c.pos }
func (c *cursor) empty() bool { return c.pos == len(c.data) }
func (c *cursor) take(n int) ([]byte, error) {
	if n < 0 || n > c.left() {
		return nil, protocolf("truncated frame")
	}
	out := c.data[c.pos : c.pos+n]
	c.pos += n
	return out, nil
}
func (c *cursor) byte() (byte, error) {
	data, err := c.take(1)
	if err != nil {
		return 0, err
	}
	return data[0], nil
}
func (c *cursor) varint() (uint64, error) {
	var value uint64
	for shift := uint(0); shift < 64; shift += 7 {
		b, err := c.byte()
		if err != nil {
			return 0, err
		}
		if shift == 63 && b > 1 {
			return 0, protocolf("varint overflow")
		}
		value |= uint64(b&0x7f) << shift
		if b&0x80 == 0 {
			return value, nil
		}
	}
	return 0, protocolf("varint overflow")
}
func (c *cursor) size() (int, error) {
	value, err := c.varint()
	if err != nil {
		return 0, err
	}
	if value > uint64(math.MaxInt) {
		return 0, protocolf("length exceeds platform")
	}
	return int(value), nil
}
func (c *cursor) rest() []byte { return c.data[c.pos:] }

func putVarint(out []byte, value uint64) []byte {
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

func latin1(value string) ([]byte, error) {
	out := make([]byte, 0, len(value))
	for _, r := range value {
		if r > 255 {
			return nil, fmt.Errorf("sonicws: %q is not Latin-1", value)
		}
		out = append(out, byte(r))
	}
	if len(out) > 255 {
		return nil, fmt.Errorf("sonicws: text exceeds 255 bytes")
	}
	return out, nil
}

func putText(out []byte, value string) ([]byte, error) {
	data, err := latin1(value)
	if err != nil {
		return nil, err
	}
	out = append(out, byte(len(data)))
	return append(out, data...), nil
}

func readText(c *cursor) (string, error) {
	size, err := c.byte()
	if err != nil {
		return "", err
	}
	data, err := c.take(int(size))
	if err != nil {
		return "", err
	}
	return latin1String(data), nil
}

func latin1String(data []byte) string {
	runes := make([]rune, len(data))
	for n, b := range data {
		runes[n] = rune(b)
	}
	return string(runes)
}
