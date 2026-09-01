package sonicws

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/liwybloc/sonic-ws/projects/go/internal/core"
)

// SonicWS close codes.
const (
	CloseRateLimit        websocket.StatusCode = 4000
	CloseSmall            websocket.StatusCode = 4001
	CloseInvalidKey       websocket.StatusCode = 4002
	CloseInvalidPacket    websocket.StatusCode = 4003
	CloseInvalidData      websocket.StatusCode = 4004
	CloseDisabledPacket   websocket.StatusCode = 4006
	CloseShutdown         websocket.StatusCode = 4008
	CloseBackpressure     websocket.StatusCode = 4009
	CloseHeartbeatTimeout websocket.StatusCode = 4010
)

// ServerConfig configures a Server.
type ServerConfig struct {
	ClientPackets     *Registry
	ServerPackets     *Registry
	Accept            *websocket.AcceptOptions
	ReadLimit         int64
	MessagesPerSecond int
	DisableRateLimit  bool
	Handler           func(context.Context, *Conn)
	OnError           func(error)

	DisableHeartbeat  bool
	HeartbeatInterval time.Duration
	HeartbeatTimeout  time.Duration

	RecoveryDuration  time.Duration
	MaxReplayPackets  int
	AuthorizeRecovery func(previous, current map[string]any, conn *Conn) bool
}

// Server is an http.Handler that upgrades SonicWS connections.
type Server struct {
	config    ServerConfig
	handshake []byte
	nextID    atomic.Uint64

	mu       sync.RWMutex
	conns    map[uint64]*Conn
	sessions map[string]*session
}

type session struct {
	mu       sync.RWMutex
	owner    *Conn
	state    map[string]any
	rooms    map[string]struct{}
	sequence uint64
	frames   []replayFrame
	expires  time.Time
}

// NewServer validates config and prepares the handshake.
func NewServer(config ServerConfig) (*Server, error) {
	if config.ClientPackets == nil {
		config.ClientPackets, _ = NewRegistry()
	}
	if config.ServerPackets == nil {
		config.ServerPackets, _ = NewRegistry()
	}
	if config.Handler == nil {
		return nil, errors.New("sonicws: server handler is required")
	}
	if config.ReadLimit <= 0 {
		config.ReadLimit = 8 << 20
	}
	if config.MessagesPerSecond <= 0 {
		config.MessagesPerSecond = 500
	}
	if config.HeartbeatInterval <= 0 {
		config.HeartbeatInterval = 30 * time.Second
	}
	if config.HeartbeatTimeout <= 0 {
		config.HeartbeatTimeout = 10 * time.Second
	}
	if config.RecoveryDuration <= 0 {
		config.RecoveryDuration = 2 * time.Minute
	}
	if config.MaxReplayPackets <= 0 {
		config.MaxReplayPackets = 1000
	}
	client, err := config.ClientPackets.MarshalBinary()
	if err != nil {
		return nil, err
	}
	server, err := config.ServerPackets.MarshalBinary()
	if err != nil {
		return nil, err
	}
	handshake := putVarint(nil, uint64(len(client)))
	handshake = append(handshake, client...)
	handshake = append(handshake, server...)
	return &Server{config: config, handshake: handshake, conns: make(map[uint64]*Conn), sessions: make(map[string]*session)}, nil
}

// ServeHTTP upgrades one WebSocket and runs its handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, s.config.Accept)
	if err != nil {
		s.report(err)
		return
	}
	ws.SetReadLimit(s.config.ReadLimit)
	conn, err := s.add(ws)
	if err != nil {
		_ = ws.Close(websocket.StatusInternalError, "server error")
		s.report(err)
		return
	}
	defer s.remove(conn)
	defer func() {
		if !conn.closed.Load() {
			_ = conn.Close(websocket.StatusInternalError, "handler stopped")
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !s.config.DisableHeartbeat {
		go s.heartbeat(ctx, conn)
	}
	s.config.Handler(ctx, conn)
	if !conn.closed.Load() {
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}
}

func (s *Server) add(ws *websocket.Conn) (*Conn, error) {
	id := s.nextID.Add(1)
	sessionID, err := randomID()
	if err != nil {
		return nil, err
	}
	sess := &session{state: make(map[string]any), rooms: make(map[string]struct{})}
	conn := newConn(ws, s.config.ClientPackets, s.config.ServerPackets)
	conn.id.Store(id)
	conn.server = s
	conn.sessionID = sessionID
	conn.session = sess
	sess.owner = conn

	payload := putVarint(nil, id)
	payload = putVarint(payload, uint64(len(sessionID)))
	payload = append(payload, sessionID...)
	payload = append(payload, s.handshake...)
	compressed, err := core.Deflate(payload)
	if err != nil {
		return nil, err
	}
	frame := append([]byte("SWS"), Version)
	frame = append(frame, compressed...)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := conn.write(ctx, frame); err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.conns[id] = conn
	s.sessions[sessionID] = sess
	s.mu.Unlock()
	return conn, nil
}

func (s *Server) remove(conn *Conn) {
	for _, packet := range conn.outgoing.packets {
		packet.forget(conn.codecID)
	}
	conn.mu.RLock()
	sess := conn.session
	sessionID := conn.sessionID
	conn.mu.RUnlock()
	now := time.Now()
	sess.mu.Lock()
	if sess.owner == conn {
		sess.owner = nil
		sess.expires = now.Add(s.config.RecoveryDuration)
	}
	expires := sess.expires
	sess.mu.Unlock()

	s.mu.Lock()
	delete(s.conns, conn.ID())
	s.mu.Unlock()
	time.AfterFunc(time.Until(expires), func() { s.expire(sessionID, sess) })
}

func (s *Server) expire(id string, expected *session) {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.sessions[id]
	if sess != expected {
		return
	}
	sess.mu.RLock()
	expired := sess.owner == nil && !sess.expires.After(now)
	sess.mu.RUnlock()
	if expired {
		delete(s.sessions, id)
	}
}

func (s *Server) heartbeat(ctx context.Context, conn *Conn) {
	ticker := time.NewTicker(s.config.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		last := time.Unix(0, conn.active.Load())
		if time.Since(last) < s.config.HeartbeatInterval {
			continue
		}
		sent := time.Now()
		writeCtx, cancel := context.WithTimeout(ctx, s.config.HeartbeatTimeout)
		err := conn.write(writeCtx, []byte{controlKey})
		cancel()
		if err != nil {
			return
		}
		timer := time.NewTimer(s.config.HeartbeatTimeout)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if time.Unix(0, conn.active.Load()).Before(sent) {
			_ = conn.Close(CloseHeartbeatTimeout, "heartbeat timeout")
			return
		}
	}
}

// Close shuts down active SonicWS connections.
func (s *Server) Close() error {
	connections := s.Connections()
	results := make(chan error, len(connections))
	for _, conn := range connections {
		go func() {
			results <- conn.Close(CloseShutdown, "server shutdown")
		}()
	}
	var errs []error
	for range connections {
		if err := <-results; err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Connections returns a snapshot of active connections.
func (s *Server) Connections() []*Conn {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Conn, 0, len(s.conns))
	for _, conn := range s.conns {
		out = append(out, conn)
	}
	return out
}

// Broadcast sends a packet to every active connection.
func (s *Server) Broadcast(ctx context.Context, tag string, values ...any) error {
	var errs []error
	for _, conn := range s.Connections() {
		if err := conn.Send(ctx, tag, values...); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// BroadcastRoom sends a packet to connections in a room.
func (s *Server) BroadcastRoom(ctx context.Context, room, tag string, values ...any) error {
	var errs []error
	for _, conn := range s.Connections() {
		if conn.InRoom(room) {
			if err := conn.Send(ctx, tag, values...); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

func (s *Server) storeReplay(conn *Conn, frame []byte) []byte {
	conn.mu.RLock()
	sess := conn.session
	conn.mu.RUnlock()
	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.sequence++
	encoded := encodeReplay(sess.sequence, frame)
	sess.frames = append(sess.frames, replayFrame{sequence: sess.sequence, frame: encoded})
	if len(sess.frames) > s.config.MaxReplayPackets {
		sess.frames = append([]replayFrame(nil), sess.frames[len(sess.frames)-s.config.MaxReplayPackets:]...)
	}
	return encoded
}

func (s *Server) resume(ctx context.Context, conn *Conn, request resumeRequest) error {
	s.mu.RLock()
	target := s.sessions[request.session]
	s.mu.RUnlock()
	if target == nil {
		return conn.write(ctx, encodeRecovery(false, 0))
	}
	target.mu.Lock()
	if target.owner != nil || !target.expires.After(time.Now()) {
		target.mu.Unlock()
		return conn.write(ctx, encodeRecovery(false, 0))
	}
	target.owner = conn
	previous := copyMap(target.state)
	target.mu.Unlock()

	current := conn.State()
	authorized := reflect.DeepEqual(previous["userId"], current["userId"])
	if previous["userId"] == nil {
		authorized = true
	}
	if s.config.AuthorizeRecovery != nil {
		authorized = s.config.AuthorizeRecovery(previous, current, conn)
	}
	if !authorized {
		target.mu.Lock()
		if target.owner == conn {
			target.owner = nil
		}
		target.mu.Unlock()
		return conn.write(ctx, encodeRecovery(false, 0))
	}

	conn.mu.Lock()
	fresh := conn.session
	freshID := conn.sessionID
	conn.session = target
	conn.sessionID = request.session
	conn.mu.Unlock()
	fresh.mu.Lock()
	if fresh.owner == conn {
		fresh.owner = nil
	}
	fresh.mu.Unlock()
	target.mu.Lock()
	target.expires = time.Time{}
	frames := append([]replayFrame(nil), target.frames...)
	target.mu.Unlock()
	s.mu.Lock()
	if s.sessions[freshID] == fresh {
		delete(s.sessions, freshID)
	}
	s.mu.Unlock()

	var replayed uint64
	for _, frame := range frames {
		if frame.sequence > request.last {
			if err := conn.write(ctx, frame.frame); err != nil {
				return err
			}
			replayed++
		}
	}
	return conn.write(ctx, encodeRecovery(true, replayed))
}

// SetState stores recovery state on a server connection.
func (c *Conn) SetState(key string, value any) {
	c.mu.RLock()
	sess := c.session
	c.mu.RUnlock()
	if sess == nil {
		return
	}
	sess.mu.Lock()
	sess.state[key] = value
	sess.mu.Unlock()
}

// State returns a shallow copy of server-side recovery state.
func (c *Conn) State() map[string]any {
	c.mu.RLock()
	sess := c.session
	c.mu.RUnlock()
	if sess == nil {
		return nil
	}
	sess.mu.RLock()
	defer sess.mu.RUnlock()
	return copyMap(sess.state)
}

// Join adds a server connection to a room.
func (c *Conn) Join(room string) error {
	if room == "" {
		return errors.New("sonicws: room is empty")
	}
	c.mu.RLock()
	sess := c.session
	c.mu.RUnlock()
	if sess == nil {
		return errors.New("sonicws: rooms require a server connection")
	}
	sess.mu.Lock()
	sess.rooms[room] = struct{}{}
	sess.mu.Unlock()
	return nil
}

// Leave removes a server connection from a room.
func (c *Conn) Leave(room string) {
	c.mu.RLock()
	sess := c.session
	c.mu.RUnlock()
	if sess != nil {
		sess.mu.Lock()
		delete(sess.rooms, room)
		sess.mu.Unlock()
	}
}

// InRoom reports whether a server connection belongs to a room.
func (c *Conn) InRoom(room string) bool {
	c.mu.RLock()
	sess := c.session
	c.mu.RUnlock()
	if sess == nil {
		return false
	}
	sess.mu.RLock()
	_, ok := sess.rooms[room]
	sess.mu.RUnlock()
	return ok
}

func copyMap(source map[string]any) map[string]any {
	out := make(map[string]any, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}

func randomID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("sonicws: random session id: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}

func (s *Server) report(err error) {
	if s.config.OnError != nil {
		s.config.OnError(err)
	}
}
