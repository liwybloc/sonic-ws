package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"math"
	"net"
	"net/http"
	"os"
	"reflect"
	"sync"
	"time"

	sonicws "github.com/liwybloc/sonic-ws/projects/go"
)

const address = "127.0.0.1:8963"

type compatCase struct {
	name     string
	send     []any
	expected []any
}

var cases = []compatCase{
	{"none", nil, nil},
	{"raw", []any{[]byte{0, 1, 128, 255}}, []any{[]byte{0, 1, 128, 255}}},
	{"ascii", []any{"hello world", "SonicWS", ""}, []any{"hello world", "SonicWS", ""}},
	{"utf16", []any{"another😂", "𐍈", "𝄞", "🧪"}, []any{"another😂", "𐍈", "𝄞", "🧪"}},
	{"enums", []any{"alpha", float64(7), true, nil}, []any{"alpha", float64(7), true, nil}},
	{"bytes", signed(-128, -1, 0, 1, 127), signed(-128, -1, 0, 1, 127)},
	{"ubytes", unsigned(0, 1, 254, 255), unsigned(0, 1, 254, 255)},
	{"shorts", signed(-32768, -1, 0, 1, 32767), signed(-32768, -1, 0, 1, 32767)},
	{"ushorts", unsigned(0, 1, 65534, 65535), unsigned(0, 1, 65534, 65535)},
	{"varint", signed(math.MinInt32, -1, 0, 1, math.MaxInt32), signed(math.MinInt32, -1, 0, 1, math.MaxInt32)},
	{"uvarint", unsigned(0, 1, 127, 128, 255, 16384, math.MaxUint32), unsigned(0, 1, 127, 128, 255, 16384, math.MaxUint32)},
	{"deltas", signed(-50, -25, 1, 2, 1000, 1004, 1004, -5), signed(-50, -25, 1, 2, 1000, 1004, 1004, -5)},
	{"floats", []any{0, 1.5, -1.5, 958412.128498, 1e-10}, []any{float64(0), float64(1.5), float64(-1.5), float64(float32(958412.128498)), float64(float32(1e-10))}},
	{"doubles", []any{0, 1.5, -1.5, 958412.128498, math.Inf(1)}, []any{float64(0), 1.5, -1.5, 958412.1284979999, math.Inf(1)}},
	{"booleans", []any{true, false, true, false, true, false, true, false, true}, []any{true, false, true, false, true, false, true, false, true}},
	{"json", []any{map[string]any{"ok": true, "nested": []any{1, "two", false, nil}}}, []any{map[string]any{"ok": true, "nested": []any{int64(1), "two", false, nil}}}},
	{"hex", []any{"00abff"}, []any{"00abff"}},
	{"object", []any{[]any{"hello", "world"}, []any{true, false, true}, signed(-1, 0, 1), []any{"right", "left"}, []any{map[string]any{"json": true}}}, []any{[]any{"hello", "world"}, []any{true, false, true}, signed(-1, 0, 1), []any{"right", "left"}, []any{map[string]any{"json": true}}}},
	{"batch", unsigned(7, 128, 16384), unsigned(7, 128, 16384)},
}

func signed(values ...int64) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

func unsigned(values ...uint64) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

func packets(prefix string) (*sonicws.Registry, error) {
	mixed := &sonicws.Enum{Name: "compat-mixed", Values: []any{"alpha", float64(7), true, nil}}
	object := &sonicws.Enum{Name: "compat-object", Values: []any{"left", "right"}}
	configs := []sonicws.PacketConfig{
		{Tag: prefix + "_none", Fields: []sonicws.Field{{Type: sonicws.None}}},
		{Tag: prefix + "_raw", Fields: []sonicws.Field{{Type: sonicws.Raw, Min: 4, Max: 4}}},
		{Tag: prefix + "_ascii", Fields: []sonicws.Field{{Type: sonicws.ASCII, Min: 3, Max: 3}}},
		{Tag: prefix + "_utf16", Fields: []sonicws.Field{{Type: sonicws.UTF16, Min: 4, Max: 4}}},
		{Tag: prefix + "_enums", Fields: []sonicws.Field{{Type: sonicws.Enums, Min: 4, Max: 4, Enum: mixed}}},
		{Tag: prefix + "_bytes", Fields: []sonicws.Field{{Type: sonicws.Bytes, Min: 5, Max: 5}}},
		{Tag: prefix + "_ubytes", Fields: []sonicws.Field{{Type: sonicws.UBytes, Min: 4, Max: 4}}},
		{Tag: prefix + "_shorts", Fields: []sonicws.Field{{Type: sonicws.Shorts, Min: 5, Max: 5}}},
		{Tag: prefix + "_ushorts", Fields: []sonicws.Field{{Type: sonicws.UShorts, Min: 4, Max: 4}}},
		{Tag: prefix + "_varint", Fields: []sonicws.Field{{Type: sonicws.VarInt, Min: 5, Max: 5}}},
		{Tag: prefix + "_uvarint", Fields: []sonicws.Field{{Type: sonicws.UVarInt, Min: 7, Max: 7}}},
		{Tag: prefix + "_deltas", Fields: []sonicws.Field{{Type: sonicws.Deltas, Min: 8, Max: 8}}},
		{Tag: prefix + "_floats", Fields: []sonicws.Field{{Type: sonicws.Floats, Min: 5, Max: 5}}},
		{Tag: prefix + "_doubles", Fields: []sonicws.Field{{Type: sonicws.Doubles, Min: 5, Max: 5}}},
		{Tag: prefix + "_booleans", Fields: []sonicws.Field{{Type: sonicws.Bools, Min: 9, Max: 9}}},
		{Tag: prefix + "_json", Fields: []sonicws.Field{{Type: sonicws.JSON, Min: 1, Max: 1}}},
		{Tag: prefix + "_hex", Fields: []sonicws.Field{{Type: sonicws.Hex, Min: 1, Max: 3}}},
		{Tag: prefix + "_object", Object: true, Fields: []sonicws.Field{{Type: sonicws.ASCII, Min: 2, Max: 2}, {Type: sonicws.Bools, Min: 3, Max: 3}, {Type: sonicws.Bytes, Min: 3, Max: 3}, {Type: sonicws.Enums, Min: 2, Max: 2, Enum: object}, {Type: sonicws.JSON, Min: 1, Max: 1}}},
		{Tag: prefix + "_batch", BatchMillis: 10, MaxBatch: 4, Compress: true, Fields: []sonicws.Field{{Type: sonicws.UVarInt, Min: 3, Max: 3}}},
	}
	out := make([]*sonicws.Packet, len(configs))
	for i, config := range configs {
		packet, err := sonicws.NewPacket(config)
		if err != nil {
			return nil, err
		}
		out[i] = packet
	}
	return sonicws.NewRegistry(out...)
}

func sendAll(ctx context.Context, conn *sonicws.Conn, prefix string) error {
	for _, test := range cases {
		tag := prefix + "_" + test.name
		fmt.Printf("sending %s\n", tag)
		var err error
		if test.name == "batch" {
			err = conn.SendBatch(ctx, tag, test.send)
		} else {
			err = conn.Send(ctx, tag, test.send...)
		}
		if err != nil {
			return fmt.Errorf("send %s: %w", tag, err)
		}
	}
	return nil
}

func compatible(actual, expected any) bool {
	if a, ok := numeric(actual); ok {
		b, ok := numeric(expected)
		return ok && (a == b || math.IsNaN(a) && math.IsNaN(b))
	}
	switch actual := actual.(type) {
	case []any:
		expected, ok := expected.([]any)
		if !ok || len(actual) != len(expected) {
			return false
		}
		for i := range actual {
			if !compatible(actual[i], expected[i]) {
				return false
			}
		}
		return true
	case [][]any:
		expected, ok := expected.([][]any)
		if !ok || len(actual) != len(expected) {
			return false
		}
		for i := range actual {
			if !compatible(actual[i], expected[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		expected, ok := expected.(map[string]any)
		if !ok || len(actual) != len(expected) {
			return false
		}
		for key, value := range actual {
			want, ok := expected[key]
			if !ok || !compatible(value, want) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(actual, expected)
	}
}

func numeric(value any) (float64, bool) {
	switch value := value.(type) {
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case uint64:
		return float64(value), true
	case float32:
		return float64(value), true
	case float64:
		return value, true
	default:
		return 0, false
	}
}

func receiveAll(ctx context.Context, conn *sonicws.Conn, prefix string) error {
	expected := make(map[string]compatCase, len(cases))
	for _, test := range cases {
		expected[prefix+"_"+test.name] = test
	}
	for len(expected) != 0 {
		message, err := conn.Receive(ctx)
		if err != nil {
			return err
		}
		event, ok := message.(*sonicws.Event)
		if !ok {
			continue
		}
		test, ok := expected[event.Tag]
		if !ok {
			return fmt.Errorf("unexpected packet %q", event.Tag)
		}
		actual := event.Values
		want := any(test.expected)
		if test.name == "batch" {
			actual = nil
			want = [][]any{test.expected}
			if !compatible(event.Batch, want) {
				return fmt.Errorf("%s mismatch: got %#v, want %#v", event.Tag, event.Batch, want)
			}
		} else if !compatible(actual, want) {
			return fmt.Errorf("%s mismatch: got %#v, want %#v", event.Tag, actual, want)
		}
		fmt.Printf("received %s\n", event.Tag)
		delete(expected, event.Tag)
	}
	return nil
}

func exchange(ctx context.Context, conn *sonicws.Conn, sendPrefix, receivePrefix string, delay time.Duration) error {
	time.Sleep(delay)
	if err := sendAll(ctx, conn, sendPrefix); err != nil {
		return err
	}
	return receiveAll(ctx, conn, receivePrefix)
}

func runHost(ctx context.Context) error {
	clientPackets, err := packets("client")
	if err != nil {
		return err
	}
	serverPackets, err := packets("server")
	if err != nil {
		return err
	}
	result := make(chan error, 1)
	var once sync.Once
	server, err := sonicws.NewServer(sonicws.ServerConfig{
		ClientPackets: clientPackets,
		ServerPackets: serverPackets,
		Handler: func(_ context.Context, conn *sonicws.Conn) {
			once.Do(func() { result <- exchange(ctx, conn, "server", "client", 250*time.Millisecond) })
		},
	})
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	httpServer := &http.Server{Handler: server}
	go func() {
		if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			once.Do(func() { result <- err })
		}
	}()
	fmt.Printf("Go host listening on ws://%s\n", address)
	select {
	case err := <-result:
		_ = server.Close()
		_ = httpServer.Shutdown(context.Background())
		return err
	case <-ctx.Done():
		_ = server.Close()
		_ = httpServer.Shutdown(context.Background())
		return ctx.Err()
	}
}

func runClient(ctx context.Context) error {
	conn, err := sonicws.Dial(ctx, "ws://"+address, nil)
	if err != nil {
		return err
	}
	defer conn.Close(1000, "")
	return exchange(ctx, conn, "client", "server", 500*time.Millisecond)
}

func main() {
	host := flag.Bool("host", false, "host a compatibility server")
	client := flag.Bool("client", false, "connect to a compatibility server")
	flag.Parse()
	if *host == *client {
		fmt.Fprintln(os.Stderr, "usage: test_compat --host | --client")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var err error
	if *host {
		err = runHost(ctx)
	} else {
		err = runClient(ctx)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Go compatibility peer passed %d packet checks\n", len(cases))
}
