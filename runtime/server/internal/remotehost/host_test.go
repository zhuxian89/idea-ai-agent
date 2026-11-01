package remotehost

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/relay"
)

func testHost(t *testing.T) *host {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("IDE_AGENT_DATA_DIR", dir)
	h, err := newHost(dir, t.TempDir(), e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "test-host", PairingSecret: "test-host-secret"}))
	if err != nil {
		t.Fatal(err)
	}
	h.relay, err = relay.NewManager("127.0.0.1:1", true, "http://127.0.0.1:1", false)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err = h.relay.Start(ctx); err != nil {
		t.Fatal(err)
	}
	h.state.Enabled = true
	t.Cleanup(h.closeRoutes)
	return h
}

func TestUpgradeStopRequiresLocalAuthenticationAndObservedVersion(t *testing.T) {
	h := testHost(t)
	h.version = "0.1.25-local.4"
	stopped := 0
	h.stop = func() { stopped++ }
	for _, tc := range []struct {
		token, version string
		public         bool
		want           int
	}{
		{"", h.version, false, 401},
		{h.token, "0.1.25-local.3", false, 409},
		{h.token, h.version, true, 404},
		{h.token, h.version, false, 200},
	} {
		body, _ := json.Marshal(map[string]string{"runtime_version": tc.version})
		req := httptest.NewRequest("POST", "/control/upgrade-stop", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+tc.token)
		response := httptest.NewRecorder()
		handler := h.controlHandler()
		if tc.public {
			handler = h.publicHandler()
		}
		handler.ServeHTTP(response, req)
		if response.Code != tc.want {
			t.Fatalf("upgrade status %d, want %d", response.Code, tc.want)
		}
	}
	if stopped != 1 || !h.state.Enabled || h.status().RuntimeVersion != h.version {
		t.Fatal("upgrade must stop exactly once without disabling the node")
	}
}
func projectBackend(t *testing.T, token string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(ProjectTokenHeader) != token {
			http.Error(w, "bad token", 401)
			return
		}
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/ws") {
			c, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer c.Close()
			for {
				typ, b, err := c.ReadMessage()
				if err != nil {
					return
				}
				if c.WriteMessage(typ, b) != nil {
					return
				}
			}
		}
		jsonResponse(w, 200, map[string]string{"path": r.URL.EscapedPath(), "query": r.URL.RawQuery, "token": r.Header.Get(ProjectTokenHeader)})
	}))
	t.Cleanup(server.Close)
	return server
}
func registration(t *testing.T, address, owner string) Registration {
	t.Helper()
	return Registration{Protocol: 1, ProjectPath: t.TempDir(), Name: "project", OwnerID: owner, Address: address, Token: "runtime-secret", E2EENodeID: "project-" + owner, PairingSecret: "pair-" + owner, Enabled: true}
}
func TestProjectOwnershipPersistenceAndExpiry(t *testing.T) {
	h := testHost(t)
	backend := projectBackend(t, "runtime-secret")
	in := registration(t, backend.URL, "A")
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, owner := range []string{"A", "B"} {
		wg.Add(1)
		go func(owner string) {
			defer wg.Done()
			copy := in
			copy.OwnerID = owner
			_, err := h.register(context.Background(), copy)
			results <- err
		}(owner)
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if err.Error() == "project_owner_conflict" {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success %d conflict %d", success, conflict)
	}
	if len(h.state.Projects) != 1 {
		t.Fatal("duplicate persistent project")
	}
	id := h.state.Projects[0].ID
	current := h.active[id]
	in.OwnerID = current.OwnerID
	again, err := h.register(context.Background(), in)
	if err != nil || again != id {
		t.Fatal("idempotent registration", again, err)
	}
	if err = h.unregister(Ownership{id, "wrong-owner"}); err == nil {
		t.Fatal("wrong owner removed live project")
	}
	h.expire(time.Now().Add(LeaseTTL + time.Second))
	if got := h.projects(); len(got) != 1 || got[0].Availability != "closed" {
		t.Fatalf("expired list: %+v", got)
	}
	reloaded, err := newHost(h.dir, h.staticDir, h.e2ee)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.state.Projects[0].ID != id {
		t.Fatal("project identity changed on restart")
	}
	in.OwnerID = "new-owner"
	again, err = h.register(context.Background(), in)
	if err != nil || again != id {
		t.Fatal("reopen identity", again, err)
	}
}
func TestProxyPreservesSignedPathAndRevokesOnlySelectedProject(t *testing.T) {
	h := testHost(t)
	backend := projectBackend(t, "runtime-secret")
	first := registration(t, backend.URL, "A")
	second := registration(t, backend.URL, "B")
	a, err := h.register(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	b, err := h.register(context.Background(), second)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(h.publicHandler())
	defer server.Close()
	path := "/p/" + a + "/api/files/a%3Ab%20c?path=%E4%B8%AD&name=a%2Fb"
	req, _ := http.NewRequest("GET", server.URL+path, nil)
	req.Header.Set(ProjectTokenHeader, "attacker-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if out["path"] != "/p/"+a+"/api/files/a%3Ab%20c" || out["query"] != "path=%E4%B8%AD&name=a%2Fb" || out["token"] != "runtime-secret" {
		t.Fatalf("changed signed request: %+v", out)
	}
	connect := func(id string) *websocket.Conn {
		t.Helper()
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/p/"+id+"/ws", nil)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	ca, cb := connect(a), connect(b)
	defer ca.Close()
	defer cb.Close()
	if err = h.enableProject(Ownership{a, "A"}, false); err != nil {
		t.Fatal(err)
	}
	ca.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err = ca.ReadMessage(); err == nil {
		t.Fatal("revoked project websocket remains open")
	}
	if err = cb.WriteMessage(websocket.TextMessage, []byte("B alive")); err != nil {
		t.Fatal(err)
	}
	cb.SetReadDeadline(time.Now().Add(time.Second))
	_, data, err := cb.ReadMessage()
	if err != nil || string(data) != "B alive" {
		t.Fatal("B disconnected", err)
	}
	response, err := http.Get(server.URL + "/p/" + a + "/api/test")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal(response.StatusCode)
	}
	if err = h.setEnabled(false); err != nil {
		t.Fatal(err)
	}
	cb.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err = cb.ReadMessage(); err == nil {
		t.Fatal("global stop leaves websocket open")
	}
}
func signedRequest(t *testing.T, method, path string, key []byte, client string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	ts := time.Now().UTC().Format(time.RFC3339)
	proofPath := req.URL.EscapedPath()
	if req.URL.RawQuery != "" {
		proofPath += "?" + req.URL.RawQuery
	}
	req.Header.Set("X-MindFS-E2EE", "1")
	req.Header.Set("X-MindFS-Client-ID", client)
	req.Header.Set("X-MindFS-TS", ts)
	req.Header.Set("X-MindFS-Proof", e2ee.BuildRequestProof(key, method, proofPath, ts, client))
	return req
}
func TestNodePairingControlsCatalogAndProjectCredentials(t *testing.T) {
	h := testHost(t)
	backend := projectBackend(t, "runtime-secret")
	in := registration(t, backend.URL, "A")
	id, err := h.register(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	handler := h.publicHandler()
	noAuth := httptest.NewRecorder()
	handler.ServeHTTP(noAuth, httptest.NewRequest("GET", "/api/remote/projects", nil))
	if noAuth.Code != 401 || strings.Contains(noAuth.Body.String(), in.PairingSecret) {
		t.Fatal(noAuth.Code, noAuth.Body.String())
	}
	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest("GET", "/api/relay/status", nil))
	if !strings.Contains(status.Body.String(), `"remote_host":true`) || strings.Contains(status.Body.String(), "pairing_secret") {
		t.Fatal(status.Body.String())
	}
	// Complete the actual host protocol handshake rather than setting sessions directly.
	private, public, err := e2ee.GenerateECDHKeypair()
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"client_id": "browser", "node_id": h.e2ee.NodeID(), "client_eph_pk": public, "client_nonce": "nonce", "proto_version": 1, "proof": e2ee.BuildOpenProof(h.e2ee.PairingSecret(), h.e2ee.NodeID(), public, "nonce")}
	body, _ := json.Marshal(input)
	opened := httptest.NewRecorder()
	handler.ServeHTTP(opened, httptest.NewRequest("POST", "/api/e2ee/open", bytes.NewReader(body)))
	var openedBody struct {
		Public string `json:"node_eph_pk"`
		Nonce  string `json:"server_nonce"`
		Proof  string `json:"server_proof"`
	}
	if err = json.Unmarshal(opened.Body.Bytes(), &openedBody); err != nil || opened.Code != 200 {
		t.Fatal(opened.Code, opened.Body.String(), err)
	}
	if !e2ee.VerifyProof(e2ee.BuildAcceptProof(h.e2ee.PairingSecret(), h.e2ee.NodeID(), public, openedBody.Public, "nonce", openedBody.Nonce), openedBody.Proof) {
		t.Fatal("invalid host proof")
	}
	remote, _ := e2ee.DecodePublicKey(openedBody.Public)
	key, err := e2ee.DeriveKey(h.e2ee.PairingSecret(), h.e2ee.NodeID(), public, openedBody.Public, "nonce", openedBody.Nonce, private, remote)
	if err != nil {
		t.Fatal(err)
	}
	catalog := httptest.NewRecorder()
	handler.ServeHTTP(catalog, signedRequest(t, "GET", "/api/remote/projects", key.Transport, "browser"))
	var envelope e2ee.CipherEnvelope
	json.Unmarshal(catalog.Body.Bytes(), &envelope)
	var projects struct {
		Projects []Project `json:"projects"`
	}
	if err = e2ee.DecryptJSON(key.Transport, &envelope, &projects); err != nil || len(projects.Projects) != 1 || projects.Projects[0].ProjectID != id {
		t.Fatal(projects, err)
	}
	access := httptest.NewRecorder()
	handler.ServeHTTP(access, signedRequest(t, "POST", "/api/remote/projects/"+id+"/access", key.Transport, "browser"))
	json.Unmarshal(access.Body.Bytes(), &envelope)
	var grant map[string]string
	if err = e2ee.DecryptJSON(key.Transport, &envelope, &grant); err != nil || grant["pairing_secret"] != in.PairingSecret {
		t.Fatal(grant, err)
	}
	tampered := signedRequest(t, "GET", "/api/remote/projects", key.Transport, "browser")
	tampered.URL.RawQuery = "other=project"
	denied := httptest.NewRecorder()
	handler.ServeHTTP(denied, tampered)
	if denied.Code != 401 {
		t.Fatal("tampered signed request accepted")
	}
	if err = h.setEnabled(false); err != nil {
		t.Fatal(err)
	}
	denied = httptest.NewRecorder()
	handler.ServeHTTP(denied, signedRequest(t, "GET", "/api/remote/projects", key.Transport, "browser"))
	if denied.Code != 503 {
		t.Fatal("disabled host leaked catalog")
	}
}
func TestControlCannotBeReachedFromPublicListener(t *testing.T) {
	h := testHost(t)
	req := httptest.NewRequest("GET", "/control/status", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)
	recorder := httptest.NewRecorder()
	h.publicHandler().ServeHTTP(recorder, req)
	if recorder.Code != 404 {
		t.Fatal(recorder.Code)
	}
	recorder = httptest.NewRecorder()
	h.controlHandler().ServeHTTP(recorder, httptest.NewRequest("GET", "/control/status", nil))
	if recorder.Code != 401 {
		t.Fatal(recorder.Code)
	}
	recorder = httptest.NewRecorder()
	h.controlHandler().ServeHTTP(recorder, req)
	if recorder.Code != 200 {
		t.Fatal(recorder.Code)
	}
}
func TestRegistrationBoundaryAndIdleExit(t *testing.T) {
	h := testHost(t)
	backend := projectBackend(t, "runtime-secret")
	in := registration(t, backend.URL, "A")
	invalid := in
	invalid.Address = "http://example.com:80"
	if _, err := h.register(context.Background(), invalid); err == nil {
		t.Fatal("external target allowed")
	}
	invalid = in
	invalid.Protocol = 2
	if _, err := h.register(context.Background(), invalid); err == nil || err.Error() != "remote_protocol_incompatible" {
		t.Fatal(err)
	}
	invalid = in
	invalid.Token = "wrong"
	if _, err := h.register(context.Background(), invalid); err == nil {
		t.Fatal("unready backend published")
	}
	id, err := h.register(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if h.expire(time.Now().Add(IdleTTL + time.Second)) {
		t.Fatal("lease expiry should start fresh idle period")
	}
	if !h.expire(time.Now().Add(LeaseTTL + IdleTTL + 20*time.Second)) {
		t.Fatal("idle host never exits")
	}
	if err = h.heartbeat(Ownership{id, "A"}); err == nil {
		t.Fatal("expired lease revived without registration")
	}
}
func TestStableProjectPathAliasesAndSameNames(t *testing.T) {
	h := testHost(t)
	backend := projectBackend(t, "runtime-secret")
	one := registration(t, backend.URL, "A")
	two := registration(t, backend.URL, "B")
	a, err := h.register(context.Background(), one)
	if err != nil {
		t.Fatal(err)
	}
	b, err := h.register(context.Background(), two)
	if err != nil || a == b {
		t.Fatal("same names conflated", err)
	}
	alias := filepath.Join(t.TempDir(), "alias")
	if err = os.Symlink(one.ProjectPath, alias); err != nil {
		t.Skip("symlinks unavailable", err)
	}
	one.ProjectPath = alias
	id, err := h.register(context.Background(), one)
	if err != nil || id != a {
		t.Fatal("alias creates project", err)
	}
}
func TestClientReconnectsFromCurrentDescriptor(t *testing.T) {
	h := testHost(t)
	control := httptest.NewServer(h.controlHandler())
	defer control.Close()
	descriptor := Descriptor{Protocol: 1, URL: control.URL, Token: h.token}
	if err := writeJSON(filepath.Join(h.dir, "host.json"), descriptor); err != nil {
		t.Fatal(err)
	}
	client := NewClient(h.dir)
	status, err := client.Status(context.Background())
	if err != nil || status.Protocol != 1 {
		t.Fatal(status, err)
	}
	backend := projectBackend(t, "runtime-secret")
	in := registration(t, backend.URL, "A")
	id, err := client.Register(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	o := Ownership{id, "A"}
	if err = client.Heartbeat(context.Background(), o); err != nil {
		t.Fatal(err)
	}
	if err = client.SetProjectEnabled(context.Background(), o, false); err != nil {
		t.Fatal(err)
	}
	if err = client.Unregister(context.Background(), o); err != nil {
		t.Fatal(err)
	}
	descriptor.Token = "invalid"
	writeJSON(filepath.Join(h.dir, "host.json"), descriptor)
	if _, err = client.Status(context.Background()); err == nil {
		t.Fatal("descriptor change ignored")
	}
}
func TestProcessLockReleasedOnClose(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "host.lock")
	a, err := os.OpenFile(file, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := os.OpenFile(file, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if ok, err := tryLock(a); err != nil || !ok {
		t.Fatal(ok, err)
	}
	if ok, err := tryLock(b); err != nil || ok {
		t.Fatal("duplicate lock", ok, err)
	}
	a.Close()
	if ok, err := tryLock(b); err != nil || !ok {
		t.Fatal("lock not released", ok, err)
	}
}

func TestHeartbeatRegistrationDoesNotRewriteState(t *testing.T) {
	h := testHost(t)
	backend := projectBackend(t, "runtime-secret")
	in := registration(t, backend.URL, "A")
	if _, err := h.register(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(h.dir, "projects.json")
	old := time.Unix(1_000_000, 0)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	if _, err := h.register(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || !info.ModTime().Equal(old) {
		t.Fatal("unchanged registration rewrote configuration", err)
	}
}
func TestReadinessDoesNotFollowRedirectOrLeakProjectToken(t *testing.T) {
	h := testHost(t)
	var leaked bool
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true; w.WriteHeader(200) }))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, 302) }))
	defer source.Close()
	in := registration(t, source.URL, "A")
	if _, err := h.register(context.Background(), in); err == nil || err.Error() != "project_not_ready" {
		t.Fatal(err)
	}
	if leaked {
		t.Fatal("readiness redirected private project token")
	}
}
func TestOfflineProjectDeepLinkLoadsShellWithoutExposingBusiness(t *testing.T) {
	h := testHost(t)
	if err := os.WriteFile(filepath.Join(h.staticDir, "index.html"), []byte("project-selector-shell"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(h.staticDir, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(h.staticDir, "assets", "test.js"), []byte("shell-assets"), 0600)
	backend := projectBackend(t, "runtime-secret")
	in := registration(t, backend.URL, "A")
	id, err := h.register(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if err = h.unregister(Ownership{id, "A"}); err != nil {
		t.Fatal(err)
	}
	handler := h.publicHandler()
	for path, want := range map[string]string{"/p/" + id + "/": "project-selector-shell", "/p/" + id + "/assets/test.js": "shell-assets"} {
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest("GET", path, nil))
		if out.Code != 200 || out.Body.String() != want {
			t.Fatal(path, out.Code, out.Body.String())
		}
	}
	out := httptest.NewRecorder()
	handler.ServeHTTP(out, httptest.NewRequest("GET", "/p/"+id+"/api/sessions", nil))
	if out.Code != 503 {
		t.Fatal("offline business route served shell", out.Code)
	}
	if err = h.setEnabled(false); err != nil {
		t.Fatal(err)
	}
	out = httptest.NewRecorder()
	handler.ServeHTTP(out, httptest.NewRequest("GET", "/p/"+id+"/", nil))
	if out.Code != 200 {
		t.Fatal("disabled host deep link cannot explain its state")
	}
	out = httptest.NewRecorder()
	handler.ServeHTTP(out, httptest.NewRequest("GET", "/p/"+id+"/api/sessions", nil))
	if out.Code != 503 {
		t.Fatal("disabled business route served shell")
	}
}

func TestManagedSharingSurvivesRegistrationRestartAndRevokesConnections(t *testing.T) {
	h := testHost(t)
	backend := projectBackend(t, "runtime-secret")
	a := registration(t, backend.URL, "A")
	b := registration(t, backend.URL, "B")
	aid, err := h.register(context.Background(), a)
	if err != nil {
		t.Fatal(err)
	}
	bid, err := h.register(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	public := httptest.NewServer(h.publicHandler())
	defer public.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(public.URL, "http")+"/p/"+aid+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	set := func(id string, enabled bool, authenticated bool) int {
		body, _ := json.Marshal(map[string]any{"project_id": id, "enabled": enabled})
		r := httptest.NewRequest("POST", "/control/projects/sharing", bytes.NewReader(body))
		if authenticated {
			r.Header.Set("Authorization", "Bearer "+h.token)
		}
		w := httptest.NewRecorder()
		h.controlHandler().ServeHTTP(w, r)
		return w.Code
	}
	if got := set(aid, false, false); got != 401 {
		t.Fatalf("unauthenticated management: %d", got)
	}
	if len(h.projects()) != 2 {
		t.Fatal("unauthorized request changed sharing")
	}
	if got := set(aid, false, true); got != 200 {
		t.Fatalf("pause: %d", got)
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err = conn.ReadMessage(); err == nil {
		t.Fatal("pause kept websocket connected")
	}
	if _, err = h.register(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	if got := h.projects(); len(got) != 1 || got[0].ProjectID != bid {
		t.Fatalf("registration undid pause: %+v", got)
	}
	response, err := http.Get(public.URL + "/p/" + aid + "/api/dirs")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatalf("paused project reachable: %d", response.StatusCode)
	}
	restored, err := newHost(h.dir, h.staticDir, h.e2ee)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restored.register(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	if got := restored.projects(); len(got) != 1 || got[0].ProjectID != bid {
		t.Fatalf("restart undid pause: %+v", got)
	}
	if err = restored.setSharing(aid, true); err != nil {
		t.Fatal(err)
	}
	if got := restored.projects(); len(got) != 2 {
		t.Fatalf("resume failed: %+v", got)
	}
	// Computer management cannot opt a project in without that project's own consent.
	a.Enabled = false
	if _, err = restored.register(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	if err = restored.setSharing(aid, true); err == nil {
		t.Fatal("management enabled a project that opted out")
	}
}

func TestSharingStateLoadsPreviousHostConfig(t *testing.T) {
	h := testHost(t)
	backend := projectBackend(t, "runtime-secret")
	in := registration(t, backend.URL, "A")
	id, err := h.register(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	// Older released host JSON has no sharing_paused field.
	old, err := os.ReadFile(filepath.Join(h.dir, "projects.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(old, []byte("sharing_paused")) {
		t.Fatal("fixture should represent old config")
	}
	restored, err := newHost(h.dir, h.staticDir, h.e2ee)
	if err != nil {
		t.Fatal(err)
	}
	if got := restored.projects(); len(got) != 1 || got[0].ProjectID != id {
		t.Fatalf("old sharing not preserved: %+v", got)
	}
	if err = restored.setSharing(id, false); err != nil {
		t.Fatal(err)
	}
	again, err := newHost(h.dir, h.staticDir, h.e2ee)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.projects()) != 0 || len(again.managedProjectsLocked()) != 1 {
		t.Fatal("paused record lost or exposed after restart")
	}
}
