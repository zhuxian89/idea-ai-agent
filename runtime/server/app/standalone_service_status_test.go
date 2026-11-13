package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"mindfs/server/internal/api"
	"mindfs/server/internal/relay"
)

// The remote panel shows "service running" only when this field is present, so the
// embedded runtime must omit it entirely rather than send an empty object.
func TestRemoteStatusReportsServiceOnlyForStandalone(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("IDE_AGENT_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "remote-access.json"), []byte(`{"enabled":false}`), 0600); err != nil {
		t.Fatal(err)
	}
	manager, err := relay.NewManager("127.0.0.1:1", true, "https://relay.invalid", false)
	if err != nil {
		t.Fatal(err)
	}
	control, err := newRemoteAccessControl(manager, &api.AppContext{})
	if err != nil {
		t.Fatal(err)
	}
	status := func(handler http.Handler, path string) map[string]any {
		t.Helper()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 200 {
			t.Fatalf("status: %d %s", response.Code, response.Body.String())
		}
		var decoded map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded
	}
	if _, present := status(control, "/api/idea/remote")["service"]; present {
		t.Fatal("embedded runtime must not report a standalone service")
	}
	gateway := &gatewayControl{manager: manager, service: standaloneService{Version: "test", Platform: "windows-amd64", Address: "127.0.0.1:7331", PID: 42, Running: true}}
	service, ok := status(gateway, "/control/remote")["service"].(map[string]any)
	if !ok || service["version"] != "test" || service["platform"] != "windows-amd64" || service["address"] != "127.0.0.1:7331" || service["pid"] != float64(42) || service["running"] != true {
		t.Fatalf("standalone service fields were not reported: %+v", service)
	}
}
