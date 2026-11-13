package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"mindfs/server/internal/backend"
	"mindfs/server/internal/fs"
	"mindfs/server/internal/remotehost"
	"mindfs/server/internal/session"
)

func TestStandaloneProcessLifecycle(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "local-ai-agent")
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	build := exec.Command("go", "build", "-o", executable, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, output)
	}
	static := filepath.Join(dir, "web")
	if err := os.MkdirAll(static, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(static, "index.html"), []byte("<html><head></head><body>Local AI Agent</body></html>"), 0600); err != nil {
		t.Fatal(err)
	}
	first, second := filepath.Join(dir, "first"), filepath.Join(dir, "second")
	for _, path := range []string{first, second} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	old := session.NewManager(fs.NewRootInfo("first", "first", first))
	if _, err := old.Create(context.Background(), session.CreateInput{Key: "existing", Type: "chat", Name: "Existing conversation"}); err != nil {
		t.Fatal(err)
	}
	if err := old.Shutdown(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	t.Setenv("IDE_AGENT_REMOTE_HOST_DIR", dir)
	t.Setenv("MINDFS_STATIC_DIR", static)
	t.Setenv("MINDFS_RELAY_BASE_URL", "http://127.0.0.1:1")
	t.Setenv("PATH", "")
	type previousProject struct {
		ID      string `json:"project_id"`
		Path    string `json:"path"`
		Enabled bool   `json:"enabled"`
	}
	previousProjects := struct {
		Enabled  bool              `json:"enabled"`
		Projects []previousProject `json:"projects"`
	}{true, []previousProject{{"old-first", first, true}}}
	projectData, err := json.Marshal(previousProjects)
	if err != nil {
		t.Fatal(err)
	}
	preserved := map[string][]byte{
		"projects.json":    projectData,
		"e2ee.json":        []byte(`{"enabled":true,"node_id":"existing-computer","pairing_secret":"existing-browser-secret"}`),
		"credentials.json": []byte(`{"relay":{"device_token":"existing-device","node_id":"existing-relay-node","endpoint":"ws://127.0.0.1:1/connector"}}`),
	}
	for filename, data := range preserved {
		if err := os.WriteFile(filepath.Join(dir, filename), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	command := func(args ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		if output, err := exec.CommandContext(ctx, executable, args...).CombinedOutput(); err != nil {
			log, _ := os.ReadFile(filepath.Join(dir, "logs", "standalone.log"))
			t.Fatalf("CLI %v: %v\n%s\n%s", args, err, output, log)
		}
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if output, err := exec.CommandContext(ctx, executable, "-stop").CombinedOutput(); err != nil {
			t.Errorf("cleanup: %v %s", err, output)
		}
		if output, err := exec.CommandContext(ctx, executable, "-stop-core").CombinedOutput(); err != nil {
			t.Errorf("core cleanup: %v %s", err, output)
		}
	})
	if output, err := exec.Command(executable, "-installation-dir").CombinedOutput(); err != nil || strings.TrimSpace(string(output)) != "" {
		t.Fatalf("uninstalled directory: %v %s", err, output)
	}
	command("-no-browser", "-no-relayer", "-addr", "127.0.0.1:0")
	if output, err := exec.Command(executable, "-installation-dir").CombinedOutput(); err != nil || strings.TrimSpace(string(output)) != dir {
		t.Fatalf("registered directory: %v %s", err, output)
	}
	client := remotehost.NewClient(dir)
	status, err := client.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Protocol != remotehost.Protocol {
		t.Fatal("wrong protocol")
	}
	before, err := remotehost.ReadDescriptor(dir)
	if err != nil {
		t.Fatal(err)
	}
	command("-no-browser", second)
	after, _ := remotehost.ReadDescriptor(dir)
	if before.Token != after.Token || before.URL != after.URL {
		t.Fatal("opening a second project replaced the service")
	}
	if lease, err := backend.Acquire(dir, true); err == nil {
		lease.Close()
		t.Fatal("embedded backend acquired data while standalone was active")
	}
	response, err := http.Get(before.URL + "/control/status")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("unprotected control access", response.StatusCode)
	}
	checkData := func() {
		t.Helper()
		for filename, before := range preserved {
			after, err := os.ReadFile(filepath.Join(dir, filename))
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("existing remote configuration changed:", filename, err)
			}
		}
		descriptor, err := remotehost.ReadDescriptor(dir)
		if err != nil {
			t.Fatal(err)
		}
		jar, _ := cookiejar.New(nil)
		browser := &http.Client{Jar: jar, Timeout: 5 * time.Second}
		login, err := browser.Get(descriptor.URL + "/?ide_token=" + descriptor.Token + "&root=first&ide=1")
		if err != nil {
			t.Fatal(err)
		}
		login.Body.Close()
		if login.StatusCode != 200 || login.Request.URL.Query().Get("ide_token") != "" || login.Request.URL.Query().Get("ide") != "1" {
			t.Fatal("invalid browser login")
		}
		oldLink, err := browser.Get(descriptor.URL + "/p/old-first/?root=old&session=existing")
		if err != nil {
			t.Fatal(err)
		}
		oldLink.Body.Close()
		if oldLink.StatusCode != 200 || oldLink.Request.URL.Path != "/" || oldLink.Request.URL.Query().Get("root") != "first" || oldLink.Request.URL.Query().Get("session") != "existing" {
			t.Fatal("old project link did not reach the imported conversation", oldLink.StatusCode, oldLink.Request.URL.Path)
		}
		for path, want := range map[string]string{"/api/dirs": "second", "/api/sessions?root=first": "Existing conversation"} {
			resp, err := browser.Get(descriptor.URL + path)
			if err != nil {
				t.Fatal(err)
			}
			var body json.RawMessage
			err = json.NewDecoder(resp.Body).Decode(&body)
			resp.Body.Close()
			if err != nil || resp.StatusCode != 200 || !strings.Contains(string(body), want) {
				t.Fatalf("%s: status=%d body=%s err=%v", path, resp.StatusCode, body, err)
			}
		}
		request, _ := http.NewRequest("POST", descriptor.URL+"/api/idea/remote/enable", strings.NewReader(`{"enabled":true}`))
		request.Header.Set("Content-Type", "application/json")
		resp, err := browser.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 503 {
			t.Fatal("-no-relayer was ignored")
		}
		parsed, _ := url.Parse(descriptor.URL)
		if len(jar.Cookies(parsed)) == 0 {
			t.Fatal("missing login cookie")
		}
	}
	checkData()
	coreBefore, err := backend.ReadCore(dir)
	if err != nil {
		t.Fatal(err)
	}
	localJar, _ := cookiejar.New(nil)
	localBrowser := &http.Client{Jar: localJar, Timeout: 5 * time.Second}
	login, err := localBrowser.Get(coreBefore.URL + "/?ide_token=" + coreBefore.Token)
	if err != nil {
		t.Fatal(err)
	}
	login.Body.Close()
	coreURL, _ := url.Parse(coreBefore.URL)
	headers := http.Header{}
	for _, cookie := range localJar.Cookies(coreURL) {
		headers.Add("Cookie", cookie.Name+"="+cookie.Value)
	}
	ws, _, err := websocket.DefaultDialer.Dial(strings.Replace(coreBefore.URL, "http://", "ws://", 1)+"/ws?client_id=isolation-test", headers)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	checkStream := func(id string) {
		t.Helper()
		if err := ws.WriteJSON(map[string]any{"type": "session.plan_mode.set", "id": id, "payload": map[string]any{"root_id": "first", "session_key": "existing", "enabled": true}}); err != nil {
			t.Fatal("local stream closed", err)
		}
		ws.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			var response struct {
				Type    string         `json:"type"`
				ID      string         `json:"id"`
				Payload map[string]any `json:"payload"`
			}
			if err := ws.ReadJSON(&response); err != nil {
				t.Fatal("local stream unavailable", err)
			}
			if response.Type == "error" {
				t.Fatal("local session operation failed", response)
			}
			if response.Type == "session.done" && response.ID == id {
				break
			}
		}
	}
	checkStream("before-restart")
	command("-restart", "-no-browser", "-no-relayer", "-addr", "127.0.0.1:0")
	checkData()
	coreAfter, err := backend.ReadCore(dir)
	if err != nil || coreBefore != coreAfter {
		t.Fatal("remote restart replaced the local core", err)
	}
	checkStream("after-restart")
	command("-stop")
	checkStream("after-stop")
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(executable, "-foreground", "-no-browser", "-no-relayer", "-addr", occupied.Addr().String()).CombinedOutput(); err == nil {
		occupied.Close()
		t.Fatal("remote service started on an occupied port", string(output))
	}
	occupied.Close()
	checkStream("after-start-failure")
	checkLocal := func() {
		t.Helper()
		jar, _ := cookiejar.New(nil)
		browser := &http.Client{Jar: jar, Timeout: 5 * time.Second}
		login, err := browser.Get(coreBefore.URL + "/?ide_token=" + coreBefore.Token + "&root=first&ide=1")
		if err != nil {
			t.Fatal(err)
		}
		login.Body.Close()
		if login.StatusCode != 200 {
			t.Fatal("local page unavailable", login.StatusCode)
		}
		for _, path := range []string{"/api/relay/status", "/api/sessions?root=first", "/api/agents", "/api/dirs"} {
			resp, err := browser.Get(coreBefore.URL + path)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != 200 {
				t.Fatal("remote failure blocked local API", path, resp.StatusCode)
			}
		}
		request, _ := http.NewRequest("POST", coreBefore.URL+"/api/sessions/existing/rename?root=first", strings.NewReader(`{"name":"Existing conversation"}`))
		request.Header.Set("Content-Type", "application/json")
		resp, err := browser.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatal("remote failure blocked local writes", resp.StatusCode)
		}
		resp, err = browser.Get(coreBefore.URL + "/api/idea/remote")
		if err != nil {
			t.Fatal(err)
		}
		var status struct {
			Service struct {
				Running bool `json:"running"`
			} `json:"service"`
			LastError string `json:"last_error"`
		}
		err = json.NewDecoder(resp.Body).Decode(&status)
		resp.Body.Close()
		if err != nil || status.Service.Running || status.LastError == "" {
			t.Fatal("remote failure was not reported in the remote panel", status, err)
		}
	}
	checkLocal()
	// A crashed process can leave its descriptor. With both ownership locks
	// released, Start must recover without asking the user to delete files.
	stale, _ := json.Marshal(after)
	if err := os.WriteFile(filepath.Join(dir, "host.json"), stale, 0600); err != nil {
		t.Fatal(err)
	}
	command("-no-browser", "-no-relayer", "-addr", "127.0.0.1:0")
	checkData()
	// A bad remote credential affects remote management, not the core login.
	active, _ := remotehost.ReadDescriptor(dir)
	broken := active
	broken.Token = strings.Repeat("z", 64)
	brokenJSON, _ := json.Marshal(broken)
	if err := os.WriteFile(filepath.Join(dir, "host.json"), brokenJSON, 0600); err != nil {
		t.Fatal(err)
	}
	checkLocal()
	checkStream("after-auth-failure")
	activeJSON, _ := json.Marshal(active)
	if err := os.WriteFile(filepath.Join(dir, "host.json"), activeJSON, 0600); err != nil {
		t.Fatal(err)
	}
	// Simulate a pre-.4 installation, whose port exists only in host.json.
	if err := os.Remove(filepath.Join(dir, "gateway-address.json")); err != nil {
		t.Fatal(err)
	}
	command("-stop")
	command("-no-browser", "-no-relayer")
	upgraded, _ := remotehost.ReadDescriptor(dir)
	if upgraded.URL != active.URL {
		t.Fatal("upgrade lost the legacy port", active.URL, upgraded.URL)
	}
	// Restart without an address keeps the actual bound port.
	command("-restart", "-no-browser", "-no-relayer")
	restarted, _ := remotehost.ReadDescriptor(dir)
	if restarted.URL != active.URL {
		t.Fatal("restart changed the configured port", active.URL, restarted.URL)
	}
	command("-unregister")
	for _, name := range []string{"core.json", "host.json", "installation.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatal("unregister retained service discovery", name, err)
		}
	}
}
