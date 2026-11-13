package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Used by the Playwright CLI to exercise the real browser and SessionService.
func TestBrowserFixture(t *testing.T) {
	dir := os.Getenv("RECONNECT_BROWSER_FIXTURE")
	if dir == "" {
		t.Skip("interactive browser fixture")
	}
	var delay atomic.Int64
	var output bytes.Buffer
	log := &recorder{encoder: json.NewEncoder(&output)}
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html")
			io.WriteString(w, "<html><head></head><body>Connection diagnostic fixture<script src=\"/fixture.js\"></script></body></html>")
		case "/fixture.js":
			http.ServeFile(w, r, filepath.Join(dir, "fixture.js"))
		case "/ws":
			up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
			c, err := up.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer c.Close()
			for {
				var msg map[string]any
				if c.ReadJSON(&msg) != nil {
					return
				}
				if msg["type"] == "ping" {
					time.Sleep(time.Duration(delay.Load()) * time.Millisecond)
					if c.WriteJSON(map[string]any{"type": "pong", "id": msg["id"]}) != nil {
						return
					}
				}
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	target, _ := url.Parse(core.URL)
	token := strings.Repeat("f", 64)
	handler := diagnosticHandler(target, token, log)
	done := make(chan struct{})
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__fixture_delay":
			var value struct {
				MS int64 `json:"ms"`
			}
			json.NewDecoder(r.Body).Decode(&value)
			delay.Store(value.MS)
			w.WriteHeader(204)
		case "/__fixture_events":
			log.mu.Lock()
			body := append([]byte(nil), output.Bytes()...)
			log.mu.Unlock()
			w.Write(body)
		case "/__fixture_done":
			close(done)
			w.WriteHeader(204)
		default:
			r.Header.Set("X-Local-AI-Gateway", token)
			handler.ServeHTTP(w, r)
		}
	}))
	defer gateway.Close()
	if err := os.WriteFile(filepath.Join(dir, "address"), []byte(gateway.URL), 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Minute):
		t.Fatal("browser fixture timed out")
	}
}

func frame(payload []byte, masked bool) []byte {
	h := []byte{0x81, 0}
	switch {
	case len(payload) < 126:
		h[1] = byte(len(payload))
	case len(payload) < 65536:
		h[1] = 126
		h = binary.BigEndian.AppendUint16(h, uint16(len(payload)))
	default:
		h[1] = 127
		h = binary.BigEndian.AppendUint64(h, uint64(len(payload)))
	}
	if masked {
		h[1] |= 128
		h = append(h, 1, 2, 3, 4)
	}
	for i, b := range payload {
		if masked {
			b ^= byte(i%4 + 1)
		}
		h = append(h, b)
	}
	return h
}

func TestFrameObserverSplitHeadersAndPayloadPrivacy(t *testing.T) {
	for _, masked := range []bool{false, true} {
		var records []map[string]any
		o := frameObserver{emit: func(e map[string]any) { records = append(records, e) }}
		wire := frame([]byte(`{"type":"ping","id":"ping-one"}`), masked)
		wire = append(wire, frame([]byte(strings.Repeat("private-chat", 20000)), masked)...)
		wire = append(wire, frame([]byte(`{"type":"pong","id":"ping-two"}`), masked)...)
		for start := 0; start < len(wire); start += 7 {
			o.feed(wire[start:min(start+7, len(wire))])
		}
		if len(records) != 3 || records[0]["probe"] != "ping-one" || records[2]["probe"] != "ping-two" {
			t.Fatalf("unexpected records: %#v", records)
		}
		encoded, _ := json.Marshal(records)
		if bytes.Contains(encoded, []byte("private-chat")) {
			t.Fatal("chat payload entered diagnostic log")
		}
	}
}

func TestDiagnosticProxyPreservesWebSocketAndHTTP(t *testing.T) {
	token := strings.Repeat("t", 64)
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Local-AI-Gateway") != token {
			t.Error("lost Core credential")
		}
		if r.URL.Path == "/" {
			w.Header().Set("Content-Type", "text/html")
			io.WriteString(w, "<html><head></head><body>original</body></html>")
			return
		}
		up := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == "http://"+r.Host }}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer c.Close()
		for {
			kind, data, err := c.ReadMessage()
			if err != nil {
				return
			}
			if err = c.WriteMessage(kind, data); err != nil {
				return
			}
		}
	}))
	defer core.Close()
	target, _ := url.Parse(core.URL)
	var output bytes.Buffer
	log := &recorder{encoder: json.NewEncoder(&output)}
	proxy := httptest.NewServer(diagnosticHandler(target, token, log))
	defer proxy.Close()
	headers := http.Header{"X-Local-Ai-Gateway": {token}, "Origin": {proxy.URL}}
	req, _ := http.NewRequest("GET", proxy.URL+"/", nil)
	req.Header = headers.Clone()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.Contains(page, []byte("__connection_observer.js")) || !bytes.Contains(page, []byte("original")) {
		t.Fatal("page injection lost content")
	}
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(proxy.URL, "http")+"/ws?client_id=probe-test", headers)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	for _, data := range [][]byte{[]byte(`{"type":"ping","id":"ping-live"}`), bytes.Repeat([]byte("private"), 20000)} {
		if err := c.WriteMessage(websocket.TextMessage, data); err != nil {
			t.Fatal(err)
		}
		_, reply, err := c.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(data, reply) {
			t.Fatal("proxy modified frame payload")
		}
	}
	log.mu.Lock()
	text := output.String()
	log.mu.Unlock()
	if strings.Contains(text, "private") || strings.Contains(text, token) {
		t.Fatal("sensitive data entered diagnostic log")
	}
	if !strings.Contains(text, "to_core") || !strings.Contains(text, "from_core") || !strings.Contains(text, "ping-live") {
		t.Fatal("missing correlated heartbeats")
	}

	for _, tc := range []struct {
		body, credential string
		status           int
	}{
		{`[{"page":"p","seq":1,"kind":"client_close","age_ms":2000,"hidden":false}]`, token, 204},
		{`[{"kind":"ping","content":"private"}]`, token, 400},
		{`[]`, "wrong", 403},
	} {
		req, _ := http.NewRequest("POST", proxy.URL+"/__connection_observer", strings.NewReader(tc.body))
		req.Header.Set("X-Local-AI-Gateway", tc.credential)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != tc.status {
			t.Fatalf("diagnostic status %d, want %d", resp.StatusCode, tc.status)
		}
	}
}
