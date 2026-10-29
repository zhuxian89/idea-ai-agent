package app

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hashicorp/yamux"
	"mindfs/server/internal/api"
	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/relay"
)

// Real connector + yamux + HTTP forwarding, using only temporary credentials.
func TestRemoteConnectorSharedAPIAndRestartPreference(t *testing.T) {
	t.Setenv("IDE_AGENT_DATA_DIR", t.TempDir())
	t.Setenv("MINDFS_RELAY_BASE_URL", "")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	connections := make(chan *yamux.Session, 4)
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-device" {
			http.Error(w, "unauthorized", 401)
			return
		}
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		session, err := yamux.Server(relay.NewWebSocketNetConn(conn), nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer session.Close()
		connections <- session
		select {
		case <-ctx.Done():
		case <-session.CloseChan():
		}
	}))
	defer cloud.Close()
	key := []byte("0123456789abcdef0123456789abcdef")
	e2 := e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "node", PairingSecret: "secret"})
	if _, err := e2.OpenSessionForClient("browser", e2ee.DerivedKey{Transport: key}); err != nil {
		t.Fatal(err)
	}
	app := &api.AppContext{E2EE: e2, ProjectLocked: true}
	routes := (&api.HTTPHandler{AppContext: app}).Routes()
	remote := httptest.NewUnstartedServer(nil)
	manager, err := relay.NewManager(remote.Listener.Addr().String(), true, cloud.URL, false)
	if err != nil {
		t.Fatal(err)
	}
	app.Relay = manager
	remote.Config.Handler = remoteAccessMiddleware(manager, routes)
	remote.Start()
	defer remote.Close()
	store, err := relay.NewCredentialsStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(relay.Credentials{Relay: relay.RelayCredentials{NodeID: "node", DeviceToken: "test-device", Endpoint: "ws" + strings.TrimPrefix(cloud.URL, "http") + "/connector"}}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Start(ctx); err != nil {
		t.Fatal(err)
	}
	control, err := newRemoteAccessControl(manager, app)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.SetEnabled(false)
	if control.enabled || manager.Status().Connected || !manager.Status().Bound {
		t.Fatal("bound node must start disabled")
	}
	if err := control.setEnabled(true); err != nil {
		t.Fatal(err)
	}
	var tunnel *yamux.Session
	select {
	case tunnel = <-connections:
	case <-time.After(3 * time.Second):
		t.Fatal("connector did not start")
	}
	forward := func(path string, proof bool) (int, []byte) {
		t.Helper()
		stream, err := tunnel.Open()
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		_ = stream.SetDeadline(time.Now().Add(3 * time.Second))
		req, _ := http.NewRequest("GET", "http://node"+path, nil)
		// Native credentials and spoofed headers cannot bypass remote proof.
		req.Header.Set("X-MindFS-Local-CLI-Token", "private")
		req.Header.Set("X-IDE-Local", "true")
		if proof {
			ts := time.Now().UTC().Format(time.RFC3339)
			req.Header.Set("X-MindFS-E2EE", "1")
			req.Header.Set("X-MindFS-Client-ID", "browser")
			req.Header.Set("X-MindFS-TS", ts)
			req.Header.Set("X-MindFS-Proof", e2ee.BuildRequestProof(key, "GET", path, ts, "browser"))
		}
		if err := req.Write(stream); err != nil {
			t.Fatal(err)
		}
		resp, err := http.ReadResponse(bufio.NewReader(stream), req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		return resp.StatusCode, body
	}
	if code, _ := forward("/api/dirs", false); code != 401 {
		t.Fatalf("unpaired: %d", code)
	}
	if code, _ := forward("/api/idea/remote", true); code != 404 {
		t.Fatalf("remote management: %d", code)
	}
	code, body := forward("/api/dirs", true)
	if code != 200 {
		t.Fatalf("paired: %d %s", code, body)
	}
	var envelope e2ee.CipherEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatal(err)
	}
	plain, err := e2ee.DecryptBytes(key, &envelope)
	if err != nil {
		t.Fatal(err)
	}
	local := httptest.NewRecorder()
	api.LocalIDEAccess(routes).ServeHTTP(local, httptest.NewRequest("GET", "/api/dirs", nil))
	if local.Code != 200 || strings.TrimSpace(string(plain)) != strings.TrimSpace(local.Body.String()) {
		t.Fatal("local and remote API differ")
	}
	if !manager.Status().Connected {
		t.Fatal("connected state not reported")
	}
	if err := control.setEnabled(false); err != nil {
		t.Fatal(err)
	}
	if manager.Status().Connected || !manager.Status().Bound {
		t.Fatal("disable must stop connector but keep binding")
	}
	select {
	case <-tunnel.CloseChan():
	case <-time.After(3 * time.Second):
		t.Fatal("connector survived disable")
	}
	response := httptest.NewRecorder()
	remote.Config.Handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/dirs", nil))
	if response.Code != 503 {
		t.Fatal("remote request survived disable")
	}
	restored, err := newRemoteAccessControl(manager, app)
	if err != nil || restored.enabled {
		t.Fatalf("disabled preference not restored: %v", err)
	}
	if err := control.setEnabled(true); err != nil {
		t.Fatal(err)
	}
	restored, err = newRemoteAccessControl(manager, app)
	if err != nil || !restored.enabled {
		t.Fatalf("enabled preference not restored: %v", err)
	}
}
