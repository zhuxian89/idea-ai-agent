package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckUpdateReadsJSONVersionWithoutRunningUpdate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("method = %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"rust-v0.155.1"}`))
	}))
	defer server.Close()

	result, err := CheckUpdate(context.Background(), Definition{
		Name: "codex",
		UpdateCheck: UpdateCheckDefinition{
			URL:       server.URL,
			JSONField: "tag_name",
		},
	}, "codex-cli 0.154.0", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if result.CurrentVersion != "0.154.0" || result.LatestVersion != "0.155.1" || !result.HasUpdate {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestCheckUpdateReadsPlainTextVersion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("2.1.277\n"))
	}))
	defer server.Close()

	result, err := CheckUpdate(context.Background(), Definition{
		Name:        "claude",
		UpdateCheck: UpdateCheckDefinition{URL: server.URL},
	}, "2.1.277 (Claude Code)", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if result.HasUpdate || result.LatestVersion != "2.1.277" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestIsVersionNewer(t *testing.T) {
	tests := []struct {
		latest  string
		current string
		want    bool
	}{
		{latest: "1.2.4", current: "1.2.3", want: true},
		{latest: "1.2.3", current: "1.2.3", want: false},
		{latest: "1.2.3", current: "1.2.3-beta.2", want: true},
		{latest: "1.2.3-beta.2", current: "1.2.3", want: false},
	}
	for _, test := range tests {
		if got := isVersionNewer(test.latest, test.current); got != test.want {
			t.Fatalf("isVersionNewer(%q, %q) = %t, want %t", test.latest, test.current, got, test.want)
		}
	}
}
