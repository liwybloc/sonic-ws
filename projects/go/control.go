package sonicws

import (
	"errors"
	"unicode/utf8"
)

const (
	controlKey byte = iota
	controlRequest
	controlResponse
	controlReplay
	controlResume
	controlResumed
)

// Request is an incoming RPC request.
type Request struct {
	ID     uint64
	Tag    string
	Values []any
}

// Response is an incoming RPC response.
type Response struct {
	ID    uint64
	Value any
	Err   error
}

// Recovery reports the result of a resume request.
type Recovery struct {
	Recovered bool
	Replayed  uint64
}

type requestFrame struct {
	id      uint64
	key     byte
	payload []byte
}

type resumeRequest struct {
	session string
	last    uint64
}

type replayFrame struct {
	sequence uint64
	frame    []byte
}

func encodeRequest(id uint64, key byte, payload []byte) []byte {
	out := putVarint([]byte{controlKey, controlRequest}, id)
	out = append(out, key)
	return append(out, payload...)
}

func encodeResponse(id uint64, value any, responseErr error) ([]byte, error) {
	out := putVarint([]byte{controlKey, controlResponse}, id)
	if responseErr != nil {
		out = append(out, 0)
		value = responseErr.Error()
	} else {
		out = append(out, 1)
	}
	data, err := encodeJSON(value)
	if err != nil {
		return nil, err
	}
	return append(out, data...), nil
}

func encodeReplay(sequence uint64, frame []byte) []byte {
	out := putVarint([]byte{controlKey, controlReplay}, sequence)
	return append(out, frame...)
}

func encodeResume(session string, last uint64) []byte {
	out := putVarint([]byte{controlKey, controlResume}, uint64(len(session)))
	out = append(out, session...)
	return putVarint(out, last)
}

func encodeRecovery(ok bool, replayed uint64) []byte {
	out := []byte{controlKey, controlResumed, boolByte(ok)}
	return putVarint(out, replayed)
}

func decodeControl(data []byte) (any, error) {
	if len(data) == 1 && data[0] == controlKey {
		return nil, nil
	}
	if len(data) < 3 || data[0] != controlKey {
		return nil, protocolf("invalid control frame")
	}
	c := cursor{data: data[2:]}
	switch data[1] {
	case controlRequest:
		id, err := c.varint()
		if err != nil {
			return nil, err
		}
		key, err := c.byte()
		if err != nil || key == 0 {
			return nil, protocolf("request has no packet key")
		}
		return requestFrame{id: id, key: key, payload: append([]byte(nil), c.rest()...)}, nil
	case controlResponse:
		id, err := c.varint()
		if err != nil {
			return nil, err
		}
		ok, err := c.byte()
		if err != nil || ok > 1 {
			return nil, protocolf("invalid response status")
		}
		value, err := decodeJSON(c.rest())
		if err != nil {
			return nil, err
		}
		response := &Response{ID: id, Value: value}
		if ok == 0 {
			response.Err = errors.New(stringValue(value))
		}
		return response, nil
	case controlReplay:
		sequence, err := c.varint()
		if err != nil || len(c.rest()) < 1 {
			return nil, protocolf("invalid replay frame")
		}
		return replayFrame{sequence: sequence, frame: append([]byte(nil), c.rest()...)}, nil
	case controlResume:
		size, err := c.size()
		if err != nil {
			return nil, err
		}
		session, err := c.take(size)
		if err != nil {
			return nil, err
		}
		last, err := c.varint()
		if err != nil || !c.empty() || !utf8.Valid(session) {
			return nil, protocolf("invalid resume frame")
		}
		return resumeRequest{session: string(session), last: last}, nil
	case controlResumed:
		ok, err := c.byte()
		if err != nil || ok > 1 {
			return nil, protocolf("invalid recovery status")
		}
		replayed, err := c.varint()
		if err != nil || !c.empty() {
			return nil, protocolf("invalid recovery result")
		}
		return &Recovery{Recovered: ok == 1, Replayed: replayed}, nil
	default:
		return nil, protocolf("unknown control type %d", data[1])
	}
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return "remote request failed"
}

func boolByte(value bool) byte {
	if value {
		return 1
	}
	return 0
}
