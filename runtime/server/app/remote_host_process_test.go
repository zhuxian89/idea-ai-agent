package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/hashicorp/yamux"
	"mindfs/server/internal/relay"
	"mindfs/server/internal/remotehost"
)

// Each child has its own environment, just as separate IDEA project runtimes do.
func TestRemoteHubProcessHelper(t *testing.T) {
	role := os.Getenv("IDE_TEST_HUB_ROLE")
	if role == "" {
		return
	}
	// An empty overlay does not remove installed default Agent definitions.
	// These transport tests must never discover or launch the machine's CLIs.
	t.Setenv("PATH", t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := func(v any) error {
		b, err := json.Marshal(v)
		if err == nil {
			_, err = fmt.Fprintln(os.Stdout, "HUB_TEST_READY "+string(b))
		}
		return err
	}
	var err error
	if role == "host" {
		err = remotehost.Run(ctx, remotehost.Options{Dir: os.Getenv("IDE_AGENT_REMOTE_HOST_DIR"), RuntimeVersion: os.Getenv("IDE_AGENT_REMOTE_VERSION"), RelayBaseURL: os.Getenv("MINDFS_RELAY_BASE_URL"), StaticDir: os.Getenv("MINDFS_STATIC_DIR"), OnReady: func(d remotehost.Descriptor) error { return ready(d) }})
	} else {
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); cancel() }()
		err = Start(ctx, "127.0.0.1:0", StartOptions{LocalOnly: true, ProjectRoot: os.Getenv("IDE_TEST_PROJECT"), AccessToken: "test-native-private-access-token-32", OnReady: func(address, root string) error {
			return ready(map[string]string{"url": "http://" + address, "root": root})
		}})
	}
	if err != nil && err != context.Canceled && err != http.ErrServerClosed {
		t.Fatal(err)
	}
}

type hubChild struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	ready   map[string]any
	done    chan struct{}
	exitErr error
}

func startHubChild(t *testing.T, role string, env map[string]string) *hubChild {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestRemoteHubProcessHelper$")
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.Env = append(cmd.Env, "IDE_TEST_HUB_ROLE="+role)
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	diagnosticPath := filepath.Join(t.TempDir(), "child.log")
	diagnostic, err := os.OpenFile(diagnosticPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = diagnostic.Close() })
	cmd.Stderr = diagnostic
	diagnostics := func() string {
		data, _ := os.ReadFile(diagnosticPath)
		if len(data) > 16<<10 {
			data = data[len(data)-(16<<10):]
		}
		return string(data)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	child := &hubChild{cmd: cmd, stdin: in, done: make(chan struct{})}
	t.Cleanup(func() {
		_ = in.Close()
		_ = cmd.Process.Kill()
		select {
		case <-child.done:
		case <-time.After(5 * time.Second):
			t.Error("test child failed to exit")
		}
	})
	ready := make(chan map[string]any, 1)
	outputDone := make(chan struct{})
	go func() {
		defer close(outputDone)
		scanner := bufio.NewScanner(out)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "HUB_TEST_READY ") {
				var value map[string]any
				if json.Unmarshal([]byte(strings.TrimPrefix(line, "HUB_TEST_READY ")), &value) == nil {
					select {
					case ready <- value:
					default:
					}
				}
			} else {
				_, _ = fmt.Fprintln(diagnostic, line)
			}
		}
		if err := scanner.Err(); err != nil {
			_, _ = fmt.Fprintln(diagnostic, "stdout:", err)
		}
	}()
	go func() { <-outputDone; child.exitErr = cmd.Wait(); close(child.done) }()
	select {
	case child.ready = <-ready:
	case <-child.done:
		t.Fatalf("%s test child exited before ready: %v\n%s", role, child.exitErr, diagnostics())
	case <-time.After(15 * time.Second):
		t.Fatalf("%s test child startup timed out\n%s", role, diagnostics())
	}
	return child
}

func TestSharedRemoteHostRealProjectProcesses(t *testing.T) {
	connections := make(chan *yamux.Session, 4)
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-device" {
			w.WriteHeader(401)
			return
		}
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		session, err := yamux.Server(relay.NewWebSocketNetConn(ws), nil)
		if err != nil {
			return
		}
		defer session.Close()
		connections <- session
		<-session.CloseChan()
	}))
	defer cloud.Close()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("test remote shell"), 0600); err != nil {
		t.Fatal(err)
	}
	hostDir := filepath.Join(dir, "host")
	if err := os.MkdirAll(hostDir, 0700); err != nil {
		t.Fatal(err)
	}
	put := func(path string, value any) {
		t.Helper()
		b, err := json.Marshal(value)
		if err == nil {
			err = os.WriteFile(path, b, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	put(filepath.Join(hostDir, "projects.json"), map[string]any{"enabled": true, "projects": []any{}})
	put(filepath.Join(hostDir, "credentials.json"), relay.Credentials{Relay: relay.RelayCredentials{NodeID: "computer", DeviceToken: "test-device", Endpoint: "ws" + strings.TrimPrefix(cloud.URL, "http") + "/connector"}})
	if err := os.WriteFile(filepath.Join(hostDir, "e2ee.json"), []byte(`{obsolete-pairing-config`), 0600); err != nil {
		t.Fatal(err)
	}
	agentPath := filepath.Join(dir, "agents.json")
	put(agentPath, map[string]any{"agents": []any{}, "shells": []any{}, "relayBaseURL": cloud.URL})
	env := map[string]string{"HOME": dir, "IDE_AGENT_REMOTE_HOST_DIR": hostDir, "IDE_AGENT_DATA_DIR": hostDir, "MINDFS_RELAY_BASE_URL": cloud.URL, "MINDFS_AGENTS_CONFIG": agentPath, "MINDFS_STATIC_DIR": dir}
	host := startHubChild(t, "host", env)
	var tunnel *yamux.Session
	select {
	case tunnel = <-connections:
	case <-time.After(10 * time.Second):
		t.Fatal("one relay connector did not connect")
	}
	// stdin closure of the launch site must not own the shared host lifetime.
	_ = host.stdin.Close()
	type project struct {
		child           *hubChild
		id, cookie, url string
	}
	projects := make([]project, 2)
	for i := range projects {
		data := filepath.Join(dir, fmt.Sprintf("data%d", i))
		root := filepath.Join(dir, fmt.Sprintf("project%d", i))
		_ = os.MkdirAll(data, 0700)
		_ = os.MkdirAll(root, 0700)
		put(filepath.Join(data, "remote-access.json"), remoteProjectPreference{Mode: "host", Enabled: true})
		if err := os.WriteFile(filepath.Join(data, "remote-host-e2ee.json"), []byte(`{obsolete-project-pairing`), 0600); err != nil {
			t.Fatal(err)
		}
		penv := map[string]string{}
		for k, v := range env {
			penv[k] = v
		}
		penv["IDE_AGENT_DATA_DIR"] = data
		penv["IDE_TEST_PROJECT"] = root
		child := startHubChild(t, "project", penv)
		localURL := child.ready["url"].(string)
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		res, err := client.Get(localURL + "/?ide_token=test-native-private-access-token-32")
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		cookie := strings.Split(res.Header.Get("Set-Cookie"), ";")[0]
		deadline := time.Now().Add(10 * time.Second)
		for {
			req, _ := http.NewRequest("GET", localURL+"/api/idea/remote", nil)
			req.Header.Set("Cookie", cookie)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			var status struct {
				ProjectID string `json:"project_id"`
				LastError string `json:"last_error"`
			}
			_ = json.NewDecoder(resp.Body).Decode(&status)
			resp.Body.Close()
			if status.ProjectID != "" {
				projects[i] = project{child: child, id: status.ProjectID, cookie: cookie, url: localURL}
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("project registration: %s", status.LastError)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	// Relay handles one HTTP request per yamux stream, as the cloud gateway does.
	// Reusing a stream races its close and makes non-idempotent POSTs fail with EOF.
	transport := &http.Transport{DisableKeepAlives: true, DialContext: func(context.Context, string, string) (net.Conn, error) { return tunnel.Open() }}
	defer transport.CloseIdleConnections()
	browser := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	var remoteStatus relay.Status
	hubJSON(t, browser, "/api/relay/status", &remoteStatus)
	if remoteStatus.E2EERequired || remoteStatus.E2EENodeID != "" {
		t.Fatal("browser pairing is still required", remoteStatus)
	}
	var catalog struct {
		Projects []remotehost.Project `json:"projects"`
	}
	hubJSON(t, browser, "/api/remote/projects", &catalog)
	if len(catalog.Projects) != 2 {
		t.Fatalf("catalog projects: %+v", catalog.Projects)
	}
	for i, p := range projects {
		var dirs []map[string]any
		hubJSON(t, browser, "/p/"+p.id+"/api/dirs", &dirs)
		if len(dirs) != 1 || dirs[0]["root_path"] != filepath.Join(dir, fmt.Sprintf("project%d", i)) {
			t.Fatalf("project isolation failed: %+v", dirs)
		}
	}
	// WebSocket uses ordinary JSON without browser pairing.
	p := projects[1]
	// The connector stream carries HTTP headers followed by Relay's message
	// frames, not RFC6455 frames; the cloud gateway upgrades the browser hop.
	ws, err := tunnel.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	upgrade, _ := http.NewRequest("GET", "http://node/p/"+p.id+"/ws?client_id=browser1", nil)
	upgrade.Header.Set("Connection", "Upgrade")
	upgrade.Header.Set("Upgrade", "websocket")
	upgrade.Header.Set("Sec-WebSocket-Version", "13")
	upgrade.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	if err = upgrade.Write(ws); err != nil {
		t.Fatal(err)
	}
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	wsReader := bufio.NewReader(ws)
	response, err := http.ReadResponse(wsReader, upgrade)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		response.Body.Close()
		t.Fatalf("connector WS handshake %s: %s", response.Status, body)
	}
	_ = ws.SetReadDeadline(time.Time{})

	// Closing A must leave B and the same host node accessible.
	_ = projects[0].child.stdin.Close()
	deadline := time.Now().Add(10 * time.Second)
	for {
		hubJSON(t, browser, "/api/remote/projects", &catalog)
		closed := false
		for _, entry := range catalog.Projects {
			if entry.ProjectID == projects[0].id && entry.Availability == "closed" {
				closed = true
			}
		}
		if closed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("A did not become closed")
		}
		time.Sleep(50 * time.Millisecond)
	}
	var dirs []map[string]any
	hubJSON(t, browser, "/p/"+p.id+"/api/dirs", &dirs)
	if len(dirs) != 1 {
		t.Fatal("closing A affected B")
	}
	select {
	case <-connections:
		t.Fatal("more than one relay connector")
	default:
	}
	// Exercise the still-open socket after A leaves; initial server broadcasts
	// are optional and cannot substitute for a request/response.
	pingPayload, err := json.Marshal(map[string]string{"id": "after-close-A", "type": "ping"})
	if err != nil {
		t.Fatal(err)
	}
	frame := make([]byte, 6, len(pingPayload)+6)
	frame[0], frame[1] = 1, websocket.TextMessage
	binary.BigEndian.PutUint32(frame[2:], uint32(len(pingPayload)))
	frame = append(frame, pingPayload...)
	if n, err := ws.Write(frame); err != nil || n != len(frame) {
		t.Fatalf("B stream closed with A: %d bytes, %v", n, err)
	}
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var header [6]byte
		if _, err := io.ReadFull(wsReader, header[:]); err != nil {
			t.Fatal("no pong after A closed", err)
		}
		if header[0] != 1 || header[1] != websocket.TextMessage {
			t.Fatalf("unexpected connector frame %d opcode %d", header[0], header[1])
		}
		size := binary.BigEndian.Uint32(header[2:])
		if size > 1<<20 {
			t.Fatal("unexpected oversized test response", size)
		}
		payload := make([]byte, size)
		if _, err := io.ReadFull(wsReader, payload); err != nil {
			t.Fatal(err)
		}
		var message struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		}
		if err = json.Unmarshal(payload, &message); err != nil {
			t.Fatal("invalid JSON WebSocket frame", err)
		}
		if message.Type == "pong" && message.ID == "after-close-A" {
			break
		}
	}

	// A host from an earlier installation must be replaceable while B's actual
	// project process stays alive. Node credentials and project IDs are retained.
	_ = ws.Close()
	beforeCredentials, err := os.ReadFile(filepath.Join(hostDir, "credentials.json"))
	if err != nil {
		t.Fatal(err)
	}
	beforeKey, err := os.ReadFile(filepath.Join(hostDir, "e2ee.json"))
	if err != nil {
		t.Fatal(err)
	}
	stop, _ := http.NewRequest("POST", host.ready["url"].(string)+"/control/upgrade-stop", strings.NewReader(`{"runtime_version":""}`))
	stop.Header.Set("Authorization", "Bearer "+host.ready["token"].(string))
	stopped, err := http.DefaultClient.Do(stop)
	if err != nil {
		t.Fatal(err)
	}
	stopped.Body.Close()
	if stopped.StatusCode != 200 {
		t.Fatal("upgrade stop", stopped.StatusCode)
	}
	select {
	case <-host.done:
	case <-time.After(5 * time.Second):
		t.Fatal("old host did not stop")
	}
	newWeb := filepath.Join(dir, "new-web")
	if err = os.Mkdir(newWeb, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(newWeb, "index.html"), []byte("updated project hub"), 0600); err != nil {
		t.Fatal(err)
	}
	env["MINDFS_STATIC_DIR"] = newWeb
	env["IDE_AGENT_REMOTE_VERSION"] = "0.1.25-local.4"
	_ = startHubChild(t, "host", env)
	select {
	case tunnel = <-connections:
	case <-time.After(10 * time.Second):
		t.Fatal("upgraded connector did not connect")
	}
	deadline = time.Now().Add(10 * time.Second)
	for {
		hubJSON(t, browser, "/api/remote/projects", &catalog)
		if len(catalog.Projects) != 2 {
			t.Fatal("upgrade lost the catalog", catalog.Projects)
		}
		ready := false
		for _, entry := range catalog.Projects {
			if entry.ProjectID == p.id && entry.Availability == "online" {
				ready = true
			}
		}
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("B did not reregister with upgraded host")
		}
		time.Sleep(50 * time.Millisecond)
	}
	hubJSON(t, browser, "/p/"+p.id+"/api/dirs", &dirs)
	if len(dirs) != 1 {
		t.Fatal("upgrade affected B's existing project session")
	}
	root, err := browser.Get("http://node/")
	if err != nil {
		t.Fatal(err)
	}
	rootHTML, _ := io.ReadAll(root.Body)
	root.Body.Close()
	if !strings.Contains(string(rootHTML), "updated project hub") {
		t.Fatal("node home still serves old assets")
	}
	afterCredentials, _ := os.ReadFile(filepath.Join(hostDir, "credentials.json"))
	afterKey, _ := os.ReadFile(filepath.Join(hostDir, "e2ee.json"))
	if !bytes.Equal(beforeCredentials, afterCredentials) || !bytes.Equal(beforeKey, afterKey) {
		t.Fatal("upgrade changed node credentials")
	}

}

func hubJSON(t *testing.T, c *http.Client, path string, out any) {
	t.Helper()
	resp, err := c.Get("http://node" + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("GET %s status %d", path, resp.StatusCode)
	}
	if err = json.NewDecoder(resp.Body).Decode(out); err != nil {
		t.Fatal(err)
	}
}

func TestRemoteConfigurationFailurePreservesLocalProject(t *testing.T) {
	dir := t.TempDir()
	data, root := filepath.Join(dir, "data"), filepath.Join(dir, "project")
	for _, p := range []string{data, root} {
		if err := os.MkdirAll(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		filepath.Join(dir, "index.html"):             "test local shell",
		filepath.Join(dir, "agents.json"):            `{"agents":[],"shells":[]}`,
		filepath.Join(data, "remote-access.json"):    `{malformed`,
		filepath.Join(data, "remote-host-e2ee.json"): `{malformed`,
	}
	for p, value := range files {
		if err := os.WriteFile(p, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	child := startHubChild(t, "project", map[string]string{
		"HOME": dir, "IDE_AGENT_DATA_DIR": data, "IDE_AGENT_REMOTE_HOST_DIR": filepath.Join(dir, "unused-host"),
		"MINDFS_AGENTS_CONFIG": filepath.Join(dir, "agents.json"), "MINDFS_STATIC_DIR": dir,
		"IDE_TEST_PROJECT": root, "MINDFS_RELAY_BASE_URL": "http://127.0.0.1:1",
	})
	localURL := child.ready["url"].(string)
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	bootstrap, err := client.Get(localURL + "/?ide_token=test-native-private-access-token-32")
	if err != nil {
		t.Fatal(err)
	}
	bootstrap.Body.Close()
	cookie := strings.Split(bootstrap.Header.Get("Set-Cookie"), ";")[0]
	if cookie == "" {
		t.Fatal("missing native cookie")
	}
	for path, want := range map[string]int{"/api/dirs": 200, "/api/idea/remote": 503} {
		req, _ := http.NewRequest("GET", localURL+path, nil)
		req.Header.Set("Cookie", cookie)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("%s status %d: %s", path, resp.StatusCode, payload)
		}
		if path == "/api/idea/remote" && !strings.Contains(string(payload), "remote access configuration") {
			t.Fatal("missing remote diagnostics", string(payload))
		}
	}
}
