package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"mindfs/server/internal/e2ee"
)

func TestIDEAccessDoesNotDisableRemoteProof(t *testing.T) {
	manager := e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "node", PairingSecret: "secret"})
	h := &HTTPHandler{AppContext: &AppContext{E2EE: manager}}
	endpoint := h.protectedEndpoint(func(w http.ResponseWriter, r *http.Request) {
		respondJSON(w, 200, map[string]string{"session": "same"})
	})
	for _, local := range []bool{false, true} {
		var handler http.Handler = endpoint
		if local {
			handler = LocalIDEAccess(handler)
		}
		r := httptest.NewRequest("GET", "/api/sessions", nil)
		r.Header.Set("X-MindFS-Relayed", "1")
		r.Header.Set("X-IDE-Local", "true")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		want := 401
		if local {
			want = 200
		}
		if w.Code != want {
			t.Fatalf("local=%v status=%d", local, w.Code)
		}
	}
}

func TestIDEAndEncryptedBrowserShareSessionBroadcast(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	manager := e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "node", PairingSecret: "secret"})
	if _, err := manager.OpenSessionForClient("remote", e2ee.DerivedKey{Transport: key}); err != nil {
		t.Fatal(err)
	}
	hub := NewStreamHub(manager)
	ready := make(chan struct{}, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		local := r.URL.Path == "/local"
		id := "remote"
		if local {
			id = "idea:local"
		}
		hub.registerClient(id, conn, local)
		defer hub.UnregisterClient(id, conn)
		hub.BindSessionClient("shared", id)
		ready <- struct{}{}
		_, _, _ = conn.ReadMessage()
	}))
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http")
	local, _, err := websocket.DefaultDialer.Dial(url+"/local", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()
	remote, _, err := websocket.DefaultDialer.Dial(url+"/remote", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer remote.Close()
	<-ready
	<-ready
	for _, id := range hub.GetSessionClientIDs("shared", false) {
		hub.SendToClient(id, WSResponse{Type: "session.test"})
	}
	_ = local.SetReadDeadline(time.Now().Add(time.Second))
	_ = remote.SetReadDeadline(time.Now().Add(time.Second))
	var localResponse WSResponse
	if err := local.ReadJSON(&localResponse); err != nil {
		t.Fatal(err)
	}
	var envelope e2ee.CipherEnvelope
	if err := remote.ReadJSON(&envelope); err != nil {
		t.Fatal(err)
	}
	payload, err := e2ee.DecryptBytes(key, &envelope)
	if err != nil {
		t.Fatal(err)
	}
	var remoteResponse WSResponse
	if err := json.Unmarshal(payload, &remoteResponse); err != nil {
		t.Fatal(err)
	}
	if localResponse.Type != "session.test" || remoteResponse.Type != localResponse.Type {
		t.Fatal("clients did not receive same event")
	}
	hub.CloseRemoteClients()
	if _, _, err := remote.ReadMessage(); err == nil {
		t.Fatal("remote connection survived disabling access")
	}
	hub.SendToClient("idea:local", WSResponse{Type: "local.still.running"})
	if err := local.ReadJSON(&localResponse); err != nil || localResponse.Type != "local.still.running" {
		t.Fatalf("local connection interrupted: %v", err)
	}
}
