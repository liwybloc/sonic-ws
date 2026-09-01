package sonicws

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestClientServer(t *testing.T) {
	ping, _ := NewValuePacket("ping", VarInt)
	pong, _ := NewValuePacket("pong", VarInt)
	clientPackets, _ := NewRegistry(ping)
	serverPackets, _ := NewRegistry(pong)

	server, err := NewServer(ServerConfig{
		ClientPackets: clientPackets, ServerPackets: serverPackets, DisableHeartbeat: true,
		Handler: func(ctx context.Context, conn *Conn) {
			message, err := conn.Receive(ctx)
			if err != nil {
				return
			}
			event := message.(*Event)
			_ = conn.Send(ctx, "pong", event.Values[0].(int64)+1)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, websocketURL(httpServer.URL), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	if err := conn.Send(ctx, "ping", 41); err != nil {
		t.Fatal(err)
	}
	message, err := conn.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	event := message.(*Event)
	if event.Tag != "pong" || event.Values[0] != int64(42) {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestRateLimit(t *testing.T) {
	packet, _ := NewValuePacket("ping", None)
	clients, _ := NewRegistry(packet)
	closed := make(chan error, 1)
	server, _ := NewServer(ServerConfig{
		ClientPackets: clients, DisableHeartbeat: true, MessagesPerSecond: 1,
		Handler: func(ctx context.Context, conn *Conn) {
			_, _ = conn.Receive(ctx)
			_, err := conn.Receive(ctx)
			closed <- err
		},
	})
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, websocketURL(httpServer.URL), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Send(ctx, "ping"); err != nil {
		t.Fatal(err)
	}
	if err := conn.Send(ctx, "ping"); err != nil {
		t.Fatal(err)
	}
	_, _ = conn.Receive(ctx)
	if err := <-closed; !errors.Is(err, ErrProtocol) {
		t.Fatalf("unexpected rate-limit error: %v", err)
	}
}

func TestRequestResponse(t *testing.T) {
	packet, _ := NewValuePacket("double", VarInt)
	clients, _ := NewRegistry(packet)
	server, err := NewServer(ServerConfig{
		ClientPackets: clients, DisableHeartbeat: true,
		Handler: func(ctx context.Context, conn *Conn) {
			message, err := conn.Receive(ctx)
			if err != nil {
				return
			}
			request := message.(*Request)
			_ = conn.Respond(ctx, request.ID, request.Values[0].(int64)*2, nil)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, websocketURL(httpServer.URL), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	id, err := conn.SendRequest(ctx, "double", 21)
	if err != nil {
		t.Fatal(err)
	}
	message, err := conn.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	response := message.(*Response)
	if response.ID != id || response.Err != nil || response.Value != int64(42) {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestRecovery(t *testing.T) {
	packet, _ := NewPacket(PacketConfig{Tag: "snapshot", Fields: []Field{{Type: VarInt}}, Replay: true})
	packets, _ := NewRegistry(packet)
	firstSent := make(chan struct{})
	server, err := NewServer(ServerConfig{
		ServerPackets: packets, DisableHeartbeat: true,
		Handler: func(ctx context.Context, conn *Conn) {
			conn.SetState("userId", "one")
			if conn.ID() == 1 {
				_ = conn.Join("room")
				if err := conn.Send(ctx, "snapshot", 7); err == nil {
					close(firstSent)
				}
			}
			for {
				if _, err := conn.Receive(ctx); err != nil {
					return
				}
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	first, err := Dial(ctx, websocketURL(httpServer.URL), nil)
	if err != nil {
		t.Fatal(err)
	}
	<-firstSent
	if err := first.Close(websocket.StatusGoingAway, "test"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		server.mu.RLock()
		defer server.mu.RUnlock()
		sess := server.sessions[first.SessionID()]
		if sess == nil {
			return false
		}
		sess.mu.RLock()
		defer sess.mu.RUnlock()
		return sess.owner == nil
	})

	second, err := Redial(ctx, websocketURL(httpServer.URL), first, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close(websocket.StatusNormalClosure, "")
	message, err := second.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if event := message.(*Event); event.Values[0] != int64(7) {
		t.Fatalf("unexpected replay: %#v", event)
	}
	message, err = second.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if recovered := message.(*Recovery); !recovered.Recovered || recovered.Replayed != 1 {
		t.Fatalf("unexpected recovery: %#v", recovered)
	}
	var resumed *Conn
	for _, conn := range server.Connections() {
		if conn.ID() == second.ID() {
			resumed = conn
		}
	}
	if resumed == nil || resumed.State()["userId"] != "one" || !resumed.InRoom("room") {
		t.Fatal("state and rooms were not restored")
	}

	if err := second.Close(websocket.StatusGoingAway, "test again"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		server.mu.RLock()
		sess := server.sessions[second.SessionID()]
		server.mu.RUnlock()
		if sess == nil {
			return false
		}
		sess.mu.RLock()
		defer sess.mu.RUnlock()
		return sess.owner == nil
	})
	third, err := Redial(ctx, websocketURL(httpServer.URL), second, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer third.Close(websocket.StatusNormalClosure, "")
	message, err = third.Receive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if recovered := message.(*Recovery); !recovered.Recovered || recovered.Replayed != 0 {
		t.Fatalf("unexpected second recovery: %#v", recovered)
	}
}

func TestFailedReplaySendIsNotRetained(t *testing.T) {
	packet, _ := NewPacket(PacketConfig{Tag: "snapshot", Fields: []Field{{Type: VarInt}}, Replay: true})
	packets, _ := NewRegistry(packet)
	type replayState struct {
		err      error
		sequence uint64
		frames   int
	}
	result := make(chan replayState, 1)
	server, err := NewServer(ServerConfig{
		ServerPackets: packets, DisableHeartbeat: true,
		Handler: func(_ context.Context, conn *Conn) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			sendErr := conn.Send(ctx, "snapshot", 7)
			conn.mu.RLock()
			sess := conn.session
			conn.mu.RUnlock()
			sess.mu.RLock()
			result <- replayState{err: sendErr, sequence: sess.sequence, frames: len(sess.frames)}
			sess.mu.RUnlock()
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, websocketURL(httpServer.URL), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	state := <-result
	if state.err == nil {
		t.Fatal("replay send unexpectedly succeeded with a canceled context")
	}
	if state.sequence != 0 || state.frames != 0 {
		t.Fatalf("failed replay send was retained: sequence=%d frames=%d", state.sequence, state.frames)
	}
}

func TestDialRejectsTruncatedHandshake(t *testing.T) {
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		_ = conn.Write(context.Background(), websocket.MessageBinary, []byte("SWS\x19\x00"))
	}))
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if conn, err := Dial(ctx, websocketURL(httpServer.URL), nil); err == nil {
		conn.Close(websocket.StatusNormalClosure, "")
		t.Fatal("accepted a truncated handshake")
	}
}

func websocketURL(url string) string { return "ws" + url[4:] }

func waitFor(t *testing.T, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if ready() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition was not met")
}
