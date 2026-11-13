package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"mindfs/server/internal/fs"
	"mindfs/server/internal/githubimport"
)

func TestGitHubImportStatusWithoutWebSocket(t *testing.T) {
	fixture := t.TempDir()
	source := filepath.Join(fixture, "source.git")
	config := filepath.Join(fixture, "gitconfig")
	for _, args := range [][]string{
		{"init", "--bare", source},
		{"config", "--file", config, "url." + filepath.ToSlash(source) + ".insteadOf", "https://github.com/example/demo"},
	} {
		if output, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}
	t.Setenv("GIT_CONFIG_GLOBAL", config)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")

	for _, locked := range []bool{false, true} {
		t.Run(map[bool]string{false: "completed", true: "failed registration"}[locked], func(t *testing.T) {
			parent := t.TempDir()
			app := &AppContext{Dirs: fs.NewRegistry(filepath.Join(t.TempDir(), "registry.json")), ProjectLocked: locked}
			service, err := githubimport.NewService(app)
			if err != nil {
				t.Fatal(err)
			}
			app.GitHub = service
			routes := (&HTTPHandler{AppContext: app}).Routes()
			body, _ := json.Marshal(map[string]string{"url": "https://github.com/example/demo", "parent_path": parent})
			response := httptest.NewRecorder()
			routes.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/imports/github", bytes.NewReader(body)))
			if response.Code != http.StatusAccepted {
				t.Fatalf("start: %d %s", response.Code, response.Body)
			}
			var accepted struct {
				TaskID string `json:"task_id"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &accepted); err != nil || accepted.TaskID == "" {
				t.Fatalf("invalid task response: %v %s", err, response.Body)
			}
			deadline := time.Now().Add(5 * time.Second)
			var status githubimport.Status
			for {
				response = httptest.NewRecorder()
				routes.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/imports/github/"+accepted.TaskID, nil))
				if response.Code != http.StatusOK {
					t.Fatalf("status: %d %s", response.Code, response.Body)
				}
				if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil {
					t.Fatal(err)
				}
				if status.Status == "done" || status.Status == "failed" {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("import did not finish", status)
				}
				time.Sleep(10 * time.Millisecond)
			}
			if status.TaskID != accepted.TaskID || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("wrong task or cacheable status", status)
			}
			if locked {
				if status.Status != "failed" || status.Message == "" || len(app.Dirs.List()) != 0 {
					t.Fatal("registration failure was not retained", status)
				}
			} else if status.Status != "done" || status.RootID != "demo" || len(app.Dirs.List()) != 1 {
				t.Fatal("completed import was not registered", status)
			}
			// A client that missed all events can still read the terminal result.
			response = httptest.NewRecorder()
			routes.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/imports/github/"+accepted.TaskID, nil))
			var retained githubimport.Status
			if err := json.Unmarshal(response.Body.Bytes(), &retained); err != nil || retained != status {
				t.Fatalf("terminal status changed: %v %+v", err, retained)
			}
			response = httptest.NewRecorder()
			routes.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/imports/github/unknown", nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("unknown task: %d", response.Code)
			}
		})
	}
}
