package sonicws

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// Event is one decoded packet or batch.
type Event struct {
	Tag    string
	Values []any
	Batch  [][]any
}

var nextCodecID atomic.Uint64

// Conn is a negotiated SonicWS connection.
type Conn struct {
	ws       *websocket.Conn
	incoming *Registry
	outgoing *Registry
	server   *Server

	id      atomic.Uint64
	codecID uint64

	mu             sync.RWMutex
	sessionID      string
	pendingSession string
	session        *session
	sent           map[byte][]byte
	received       map[byte][]byte

	readMu      sync.Mutex
	sendMu      sync.Mutex
	writeMu     sync.Mutex
	rateMu      sync.Mutex
	rateWindow  time.Time
	rateCount   int
	closed      atomic.Bool
	active      atomic.Int64
	nextRequest atomic.Uint64
	checkpoint  atomic.Uint64
}

func newConn(ws *websocket.Conn, incoming, outgoing *Registry) *Conn {
	c := &Conn{ws: ws, incoming: incoming, outgoing: outgoing, codecID: nextCodecID.Add(1), sent: make(map[byte][]byte), received: make(map[byte][]byte)}
	c.active.Store(time.Now().UnixNano())
	return c
}

// ID returns the server-assigned connection ID.
func (c *Conn) ID() uint64 { return c.id.Load() }

// SessionID returns the current recovery session ID.
func (c *Conn) SessionID() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.sessionID
}

// RecoveryCheckpoint returns the last replay sequence received.
func (c *Conn) RecoveryCheckpoint() uint64 { return c.checkpoint.Load() }

// Send writes one negotiated packet.
func (c *Conn) Send(ctx context.Context, tag string, values ...any) error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	key, ok := c.outgoing.Key(tag)
	if !ok {
		return fmt.Errorf("sonicws: unknown packet %q", tag)
	}
	packet, _ := c.outgoing.ByKey(key)
	previous, existed := packet.residualState(c.codecID)
	data, err := packet.encodeFor(c.codecID, values)
	if err != nil {
		return err
	}
	c.mu.Lock()
	if packet.rereference && bytes.Equal(c.sent[key], data) {
		data = nil
	}
	c.mu.Unlock()
	frame := append([]byte{key}, data...)
	var writeErr error
	if packet.replay && c.server != nil {
		writeErr = c.server.writeReplay(ctx, c, frame)
	} else {
		writeErr = c.write(ctx, frame)
	}
	if writeErr != nil {
		packet.restoreResidual(c.codecID, previous, existed)
		return writeErr
	}
	if packet.rereference && len(data) != 0 {
		c.mu.Lock()
		c.sent[key] = append([]byte(nil), data...)
		c.mu.Unlock()
	}
	return nil
}

// SendBatch writes a packet configured for batching.
func (c *Conn) SendBatch(ctx context.Context, tag string, items ...[]any) error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	key, ok := c.outgoing.Key(tag)
	if !ok {
		return fmt.Errorf("sonicws: unknown packet %q", tag)
	}
	packet, _ := c.outgoing.ByKey(key)
	previous, existed := packet.residualState(c.codecID)
	data, err := packet.encodeBatchFor(c.codecID, items)
	if err != nil {
		packet.restoreResidual(c.codecID, previous, existed)
		return err
	}
	if err := c.write(ctx, append([]byte{key}, data...)); err != nil {
		packet.restoreResidual(c.codecID, previous, existed)
		return err
	}
	return nil
}

// SendRequest writes an RPC request and returns its ID.
func (c *Conn) SendRequest(ctx context.Context, tag string, values ...any) (uint64, error) {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	key, ok := c.outgoing.Key(tag)
	if !ok {
		return 0, fmt.Errorf("sonicws: unknown packet %q", tag)
	}
	packet, _ := c.outgoing.ByKey(key)
	previous, existed := packet.residualState(c.codecID)
	payload, err := packet.encodeFor(c.codecID, values)
	if err != nil {
		return 0, err
	}
	id := c.nextRequest.Add(1)
	if id == 0 {
		id = c.nextRequest.Add(1)
	}
	if err := c.write(ctx, encodeRequest(id, key, payload)); err != nil {
		packet.restoreResidual(c.codecID, previous, existed)
		return 0, err
	}
	return id, nil
}

// Respond answers an incoming request.
func (c *Conn) Respond(ctx context.Context, id uint64, value any, responseErr error) error {
	frame, err := encodeResponse(id, value, responseErr)
	if err != nil {
		return err
	}
	return c.write(ctx, frame)
}

// Resume asks the server to restore a previous session.
func (c *Conn) Resume(ctx context.Context, session string, checkpoint uint64) error {
	if session == "" {
		return errors.New("sonicws: recovery session is empty")
	}
	c.mu.Lock()
	c.pendingSession = session
	c.mu.Unlock()
	c.setCheckpoint(checkpoint)
	return c.write(ctx, encodeResume(session, checkpoint))
}

// Receive returns the next Event, Request, Response, or Recovery.
func (c *Conn) Receive(ctx context.Context) (any, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()
	for {
		kind, data, err := c.ws.Read(ctx)
		if err != nil {
			return nil, err
		}
		c.active.Store(time.Now().UnixNano())
		if c.server != nil && !c.server.config.DisableRateLimit && !c.allowMessage() {
			_ = c.close(CloseRateLimit, "message rate exceeded")
			return nil, protocolf("message rate exceeded")
		}
		if kind != websocket.MessageBinary {
			_ = c.close(websocket.StatusUnsupportedData, "binary messages required")
			return nil, protocolf("text message received")
		}
		if len(data) == 0 {
			_ = c.close(CloseSmall, "empty message")
			return nil, protocolf("empty message")
		}
		if data[0] != controlKey {
			if _, ok := c.incoming.ByKey(data[0]); !ok {
				_ = c.close(CloseInvalidKey, "invalid packet key")
				return nil, protocolf("packet key %d is invalid", data[0])
			}
			event, err := c.event(data)
			if err != nil {
				_ = c.close(CloseInvalidPacket, "invalid packet")
			}
			return event, err
		}
		message, err := decodeControl(data)
		if err != nil {
			_ = c.close(CloseInvalidData, "invalid control frame")
			return nil, err
		}
		switch message := message.(type) {
		case nil:
			if err := c.write(ctx, []byte{controlKey}); err != nil {
				return nil, err
			}
		case replayFrame:
			checkpoint := c.RecoveryCheckpoint()
			if message.sequence <= checkpoint {
				continue
			}
			c.setCheckpoint(message.sequence)
			return c.event(message.frame)
		case resumeRequest:
			if c.server == nil {
				return nil, protocolf("client received a resume request")
			}
			if err := c.server.resume(ctx, c, message); err != nil {
				return nil, err
			}
		case *Recovery:
			c.mu.Lock()
			if message.Recovered {
				c.sessionID = c.pendingSession
			} else {
				c.setCheckpoint(0)
			}
			c.pendingSession = ""
			c.mu.Unlock()
			return message, nil
		case requestFrame:
			packet, ok := c.incoming.ByKey(message.key)
			if !ok {
				_ = c.close(CloseInvalidKey, "invalid request packet key")
				return nil, protocolf("request packet key %d is invalid", message.key)
			}
			values, err := packet.Decode(message.payload)
			if err != nil {
				_ = c.close(CloseInvalidPacket, "invalid request packet")
				return nil, err
			}
			return &Request{ID: message.id, Tag: packet.tag, Values: values}, nil
		default:
			return message, nil
		}
	}
}

func (c *Conn) event(frame []byte) (*Event, error) {
	key := frame[0]
	packet, ok := c.incoming.ByKey(key)
	if !ok {
		return nil, protocolf("packet key %d is invalid", key)
	}
	data := frame[1:]
	if packet.rereference {
		c.mu.Lock()
		if len(data) == 0 {
			data = c.received[key]
			if data == nil {
				c.mu.Unlock()
				return nil, protocolf("packet %q has no value to rereference", packet.tag)
			}
		} else {
			c.received[key] = append([]byte(nil), data...)
		}
		data = append([]byte(nil), data...)
		c.mu.Unlock()
	}
	if packet.Batched() {
		batch, err := packet.DecodeBatch(data)
		return &Event{Tag: packet.tag, Batch: batch}, err
	}
	values, err := packet.Decode(data)
	return &Event{Tag: packet.tag, Values: values}, err
}

func (c *Conn) allowMessage() bool {
	c.rateMu.Lock()
	defer c.rateMu.Unlock()
	now := time.Now()
	if c.rateWindow.IsZero() || now.Sub(c.rateWindow) >= time.Second {
		c.rateWindow, c.rateCount = now, 1
		return true
	}
	c.rateCount++
	return c.rateCount <= c.server.config.MessagesPerSecond
}

func (c *Conn) write(ctx context.Context, data []byte) error {
	if c.closed.Load() {
		return errors.New("sonicws: connection is closed")
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.Write(ctx, websocket.MessageBinary, data)
}

// Close performs a WebSocket close handshake.
func (c *Conn) Close(code websocket.StatusCode, reason string) error {
	return c.close(code, reason)
}

func (c *Conn) close(code websocket.StatusCode, reason string) error {
	if !c.closed.Swap(true) {
		for _, packet := range c.outgoing.packets {
			packet.forget(c.codecID)
		}
	}
	if err := c.ws.Close(code, reason); err != nil {
		_ = c.ws.CloseNow()
		return err
	}
	return nil
}

func (c *Conn) setCheckpoint(sequence uint64) { c.checkpoint.Store(sequence) }
