package api

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mindfs/server/internal/e2ee"
	"mindfs/server/internal/relay"
)

func TestPathForStaticAssetCleansURLPaths(t *testing.T) {
	tests := []struct {
		name        string
		requestPath string
		want        string
	}{
		{
			name:        "absolute asset path",
			requestPath: "/assets/app.js",
			want:        "assets/app.js",
		},
		{
			name:        "duplicate slash path",
			requestPath: "//assets/app.js",
			want:        "assets/app.js",
		},
		{
			name:        "root path",
			requestPath: "/",
			want:        "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := pathForStaticAsset(tt.requestPath)
			if got != tt.want {
				t.Fatalf("pathForStaticAsset(%q) = %q, want %q", tt.requestPath, got, tt.want)
			}
		})
	}
}

func TestFrontendAssetsStayWithBackend(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"index.html":            `<html><head><script type="module" src="./assets/index-test.js"></script><link rel="stylesheet" href="./assets/index-test.css"></head></html>`,
		"service-worker.js":     `const PRECACHE = ["./assets/index-test.js", "./assets/index-test.css"];`,
		"assets/index-test.js":  "console.log('backend assets')",
		"assets/index-test.css": "body{}",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, mode := range []struct {
		name       string
		context    *AppContext
		standalone bool
	}{
		{name: "default"},
		{name: "embedded", context: &AppContext{ProjectLocked: true}},
		{name: "standalone", standalone: true},
	} {
		for _, version := range []string{"0.1.29", "v0.1.29", "0.1.29-local", "idea-0.1.0"} {
			for _, relayed := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/relayed=%t", mode.name, version, relayed), func(t *testing.T) {
					handler := &HTTPHandler{StaticDir: dir, Version: version, Standalone: mode.standalone, AppContext: mode.context}
					server := httptest.NewServer(http.HandlerFunc(handler.handleFrontend))
					defer server.Close()
					for _, resource := range []string{"/", "/service-worker.js", "/assets/index-test.js", "/assets/index-test.css"} {
						request, err := http.NewRequest(http.MethodGet, server.URL+resource, nil)
						if err != nil {
							t.Fatal(err)
						}
						if relayed {
							request.Header.Set("X-MindFS-Relayed", "1")
						}
						response, err := server.Client().Do(request)
						if err != nil {
							t.Fatal(err)
						}
						content, err := io.ReadAll(response.Body)
						response.Body.Close()
						if err != nil {
							t.Fatal(err)
						}
						if response.StatusCode != http.StatusOK {
							t.Fatalf("%s: status %d", resource, response.StatusCode)
						}
						body := string(content)
						if strings.Contains(body, "/mindfs-assets/") {
							t.Fatalf("%s points to Relay's shared frontend: %s", resource, body)
						}
						if resource == "/" {
							for _, asset := range []string{"./assets/index-test.js", "./assets/index-test.css"} {
								if !strings.Contains(body, asset) {
									t.Fatalf("index lost its backend asset reference %s: %s", asset, body)
								}
							}
							if mode.standalone && !strings.Contains(body, `name="local-ai-agent-mode" content="standalone"`) {
								t.Fatal("standalone mode was lost", body)
							}
							if got := strings.Contains(body, `name="local-ai-agent-version" content="`+version+`"`); got != mode.standalone {
								t.Fatal("unexpected standalone version metadata", body)
							}
						} else if want := files[strings.TrimPrefix(resource, "/")]; body != want {
							t.Fatalf("%s content = %q, want %q", resource, body, want)
						}
					}
				})
			}
		}
	}
}

func TestRelayedFrontendWithoutAssetsReportsMissingFiles(t *testing.T) {
	handler := &HTTPHandler{Version: "0.1.29"}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("X-MindFS-Relayed", "1")
	response := httptest.NewRecorder()
	handler.handleFrontend(response, request)
	if !strings.Contains(response.Body.String(), "frontend assets missing: web/index.html") {
		t.Fatal("missing frontend files were not reported", response.Body.String())
	}
}

func TestIsLocalCLIRequestRequiresTokenLoopbackAndWhitelistedRoute(t *testing.T) {
	handler := &HTTPHandler{LocalCLIToken: "secret-token"}
	req := httptest.NewRequest(http.MethodPost, "/api/dirs", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	req.Header.Set(localCLIHeaderName, "secret-token")

	if !handler.isLocalCLIRequest(req) {
		t.Fatal("expected local CLI request to be accepted")
	}
}

func TestIsLocalCLIRequestAllowsRelayBindStart(t *testing.T) {
	handler := &HTTPHandler{LocalCLIToken: "secret-token"}
	req := httptest.NewRequest(http.MethodPost, "/api/relay/bind/start", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	req.Header.Set(localCLIHeaderName, "secret-token")

	if !handler.isLocalCLIRequest(req) {
		t.Fatal("expected local CLI relay bind request to be accepted")
	}
}

func TestIsLocalCLIRequestRejectsNonWhitelistedRoute(t *testing.T) {
	handler := &HTTPHandler{LocalCLIToken: "secret-token"}
	req := httptest.NewRequest(http.MethodGet, "/api/tree", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	req.Header.Set(localCLIHeaderName, "secret-token")

	if handler.isLocalCLIRequest(req) {
		t.Fatal("expected non-whitelisted route to be rejected")
	}
}

func TestIsLocalCLIRequestRejectsRemoteAddress(t *testing.T) {
	handler := &HTTPHandler{LocalCLIToken: "secret-token"}
	req := httptest.NewRequest(http.MethodPost, "/api/dirs", nil)
	req.RemoteAddr = "192.0.2.1:54321"
	req.Header.Set(localCLIHeaderName, "secret-token")

	if handler.isLocalCLIRequest(req) {
		t.Fatal("expected remote address to be rejected")
	}
}

func TestIsLocalCLIRequestRejectsInvalidToken(t *testing.T) {
	handler := &HTTPHandler{LocalCLIToken: "secret-token"}
	req := httptest.NewRequest(http.MethodPost, "/api/dirs", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	req.Header.Set(localCLIHeaderName, "wrong-token")

	if handler.isLocalCLIRequest(req) {
		t.Fatal("expected invalid token to be rejected")
	}
}

func TestRelayStatusWithE2EEDoesNotSetNodeIDWhenE2EEDisabled(t *testing.T) {
	handler := &HTTPHandler{AppContext: &AppContext{
		E2EE: e2ee.NewManager(e2ee.Config{Enabled: false, NodeID: "node-id", PairingSecret: "secret"}),
	}}
	status := handler.relayStatusWithE2EE(relay.Status{NodeID: "relay-node"})

	if status.E2EERequired {
		t.Fatal("expected E2EERequired to be false")
	}
	if status.E2EENodeID != "" {
		t.Fatalf("E2EENodeID = %q, want empty", status.E2EENodeID)
	}
	if status.NodeID != "relay-node" {
		t.Fatalf("NodeID = %q, want relay-node", status.NodeID)
	}
}

func TestRelayStatusWithE2EEDoesNotFallbackNodeIDWhenEnabled(t *testing.T) {
	handler := &HTTPHandler{AppContext: &AppContext{
		E2EE: e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "e2ee-node", PairingSecret: "secret"}),
	}}
	status := handler.relayStatusWithE2EE(relay.Status{})

	if !status.E2EERequired {
		t.Fatal("expected E2EERequired to be true")
	}
	if status.E2EENodeID != "e2ee-node" {
		t.Fatalf("E2EENodeID = %q, want e2ee-node", status.E2EENodeID)
	}
	if status.NodeID != "" {
		t.Fatalf("NodeID = %q, want empty", status.NodeID)
	}
}

func TestRelayStatusSessionAllowsPublicStatusWithoutE2EEHeader(t *testing.T) {
	handler := &HTTPHandler{AppContext: &AppContext{
		E2EE: e2ee.NewManager(e2ee.Config{Enabled: true, NodeID: "e2ee-node", PairingSecret: "secret"}),
	}}
	req := httptest.NewRequest(http.MethodGet, "/api/relay/status", nil)

	sess, err := handler.relayStatusSession(req)
	if err != nil {
		t.Fatalf("relayStatusSession() error = %v", err)
	}
	if sess != nil {
		t.Fatalf("relayStatusSession() = %+v, want nil public session", sess)
	}
}

func TestPublicRelayStatusRedactsSensitiveRelayFields(t *testing.T) {
	status := publicRelayStatus(relay.Status{
		Bound:        true,
		NoRelayer:    false,
		PendingCode:  "pc_secret",
		NodeName:     "node-name",
		NodeID:       "node-id",
		E2EENodeID:   "e2ee-node",
		RelayBaseURL: "https://relay.example.com",
		NodeURL:      "https://relay.example.com/n/node-id/",
		LastError:    "err",
		E2EERequired: true,
	})

	if !status.E2EERequired || status.E2EENodeID != "e2ee-node" {
		t.Fatalf("public E2EE fields = required:%v node:%q", status.E2EERequired, status.E2EENodeID)
	}
	if status.PendingCode != "" || status.NodeID != "" || status.NodeURL != "" || status.RelayBaseURL != "" || status.NodeName != "" || status.LastError != "" {
		t.Fatalf("public status leaked sensitive fields: %+v", status)
	}
}
