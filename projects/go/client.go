package sonicws

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/coder/websocket"
	"github.com/liwybloc/sonic-ws/projects/go/internal/core"
)

// DialOptions configures a client connection.
type DialOptions struct {
	WebSocket *websocket.DialOptions
	ReadLimit int64
}

// Dial connects and completes SonicWS schema negotiation.
func Dial(ctx context.Context, url string, options *DialOptions) (*Conn, error) {
	var websocketOptions *websocket.DialOptions
	readLimit := int64(8 << 20)
	if options != nil {
		websocketOptions = options.WebSocket
		if options.ReadLimit > 0 {
			readLimit = options.ReadLimit
		}
	}
	ws, _, err := websocket.Dial(ctx, url, websocketOptions)
	if err != nil {
		return nil, fmt.Errorf("sonicws: dial: %w", err)
	}
	ok := false
	defer func() {
		if !ok {
			_ = ws.CloseNow()
		}
	}()
	ws.SetReadLimit(readLimit)
	kind, frame, err := ws.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("sonicws: handshake: %w", err)
	}
	if kind != websocket.MessageBinary || len(frame) < 4 || string(frame[:3]) != "SWS" {
		return nil, protocolf("invalid server handshake")
	}
	if frame[3] != Version {
		return nil, protocolf("version %d does not match %d", frame[3], Version)
	}
	data, err := core.Inflate(frame[4:])
	if err != nil {
		return nil, fmt.Errorf("sonicws: handshake: %w", err)
	}
	c := cursor{data: data}
	id, err := c.varint()
	if err != nil {
		return nil, err
	}
	sessionSize, err := c.size()
	if err != nil {
		return nil, err
	}
	session, err := c.take(sessionSize)
	if err != nil || !utf8.Valid(session) {
		return nil, protocolf("invalid session id")
	}
	clientSize, err := c.size()
	if err != nil {
		return nil, err
	}
	clientData, err := c.take(clientSize)
	if err != nil {
		return nil, err
	}
	outgoing, err := ParseRegistry(clientData)
	if err != nil {
		return nil, err
	}
	incoming, err := ParseRegistry(c.rest())
	if err != nil {
		return nil, err
	}
	conn := newConn(ws, incoming, outgoing)
	conn.id.Store(id)
	conn.sessionID = string(session)
	ok = true
	return conn, nil
}

// Redial connects and requests recovery of a previous connection.
func Redial(ctx context.Context, url string, previous *Conn, options *DialOptions) (*Conn, error) {
	if previous == nil {
		return nil, errors.New("sonicws: previous connection is nil")
	}
	session := previous.SessionID()
	checkpoint := previous.RecoveryCheckpoint()
	conn, err := Dial(ctx, url, options)
	if err != nil {
		return nil, err
	}
	if err := conn.Resume(ctx, session, checkpoint); err != nil {
		_ = conn.Close(websocket.StatusInternalError, "recovery failed")
		return nil, err
	}
	return conn, nil
}
