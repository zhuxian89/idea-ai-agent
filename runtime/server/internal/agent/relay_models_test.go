package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	agenttypes "mindfs/server/internal/agent/types"
)

func TestMergeRelayModelsDeduplicatesAgainstNativeAndPreservesMetadata(t *testing.T) {
	native := []agenttypes.ModelInfo{
		{
			ID:            "gpt-6.2-sol",
			Name:          "GPT 6.2 Sol",
			Description:   "Official metadata",
			SupportEffort: true,
			Efforts:       []string{"low", "medium", "high", "xhigh"},
		},
		{
			ID:            "gpt-5.4-mini",
			Name:          "GPT 5.4 Mini",
			Description:   "Official mini metadata",
			SupportEffort: true,
			Efforts:       []string{"low", "high"},
		},
	}
	got := MergeRelayModels(native, []string{"Auto", " gpt-6.2-sol ", "GLM-5.4", "", "GLM-5.4", "DeepSeek-V4-Pro", "gpt-5.4-mini"})
	want := []agenttypes.ModelInfo{
		native[0],
		native[1],
		{ID: "Auto", Name: "Auto"},
		{ID: "GLM-5.4", Name: "GLM-5.4"},
		{ID: "DeepSeek-V4-Pro", Name: "DeepSeek-V4-Pro"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("merged = %+v, want %+v", got, want)
	}
}

func TestSupplementActiveRelayModelsCodexFromConfigToml(t *testing.T) {
	var seenAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		seenAuth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"id": "gpt-6.2-sol"},
				{"id": "GLM-5.4"},
				{"id": "DeepSeek-V4-Pro"},
			},
		})
	}))
	defer srv.Close()

	codexHome := t.TempDir()
	configToml := `
model_provider = "custom"
[model_providers.custom]
name = "custom"
base_url = "` + srv.URL + `/v1"
experimental_bearer_token = "tok-codex-relay"
`
	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte(configToml), 0o600); err != nil {
		t.Fatalf("write config.toml: %v", err)
	}

	native := []agenttypes.ModelInfo{{
		ID:            "gpt-6.2-sol",
		Name:          "GPT 6.2 Sol",
		SupportEffort: true,
		Efforts:       []string{"low", "high"},
	}}
	got := SupplementActiveRelayModels(context.Background(), "codex", Definition{
		Name: "codex",
		Env:  map[string]string{"CODEX_HOME": codexHome},
	}, native)

	if seenAuth != "Bearer tok-codex-relay" {
		t.Fatalf("Authorization = %q, want Bearer tok-codex-relay", seenAuth)
	}
	want := []agenttypes.ModelInfo{
		native[0],
		{ID: "GLM-5.4", Name: "GLM-5.4"},
		{ID: "DeepSeek-V4-Pro", Name: "DeepSeek-V4-Pro"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("models = %+v, want %+v", got, want)
	}
}

func TestSupplementActiveRelayModelsClaudeFromSettingsJSON(t *testing.T) {
	var seenKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		seenKey = r.Header.Get("x-api-key")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"id": "claude-opus-4-6"},
				{"id": "GLM-5.4"},
			},
		})
	}))
	defer srv.Close()

	claudeDir := t.TempDir()
	settingsPayload, _ := json.Marshal(map[string]any{
		"env": map[string]string{
			"ANTHROPIC_BASE_URL":   srv.URL,
			"ANTHROPIC_AUTH_TOKEN": "tok-claude-relay",
		},
	})
	if err := os.WriteFile(filepath.Join(claudeDir, "settings.json"), settingsPayload, 0o600); err != nil {
		t.Fatalf("write settings.json: %v", err)
	}

	native := []agenttypes.ModelInfo{{
		ID:            "claude-opus-4-6",
		Name:          "Opus 4.6",
		SupportEffort: true,
		Efforts:       []string{"low", "medium", "high", "max"},
	}}
	got := SupplementActiveRelayModels(context.Background(), "claude", Definition{
		Name: "claude",
		Env:  map[string]string{"CLAUDE_CONFIG_DIR": claudeDir},
	}, native)

	if seenKey != "tok-claude-relay" {
		t.Fatalf("x-api-key = %q, want tok-claude-relay", seenKey)
	}
	want := []agenttypes.ModelInfo{
		native[0],
		{ID: "GLM-5.4", Name: "GLM-5.4"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("models = %+v, want %+v", got, want)
	}
}

func TestSupplementActiveRelayModelsGeminiUsesHeaderNotQueryKey(t *testing.T) {
	var seenHeader, seenQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models" {
			http.NotFound(w, r)
			return
		}
		seenHeader = r.Header.Get("x-goog-api-key")
		seenQuery = r.URL.RawQuery
		_ = json.NewEncoder(w).Encode(map[string]any{
			"models": []map[string]string{
				{"name": "models/gemini-2.5-pro"},
				{"name": "models/relay-gemini-extra"},
			},
		})
	}))
	defer srv.Close()

	home := t.TempDir()
	geminiDir := filepath.Join(home, ".gemini")
	if err := os.MkdirAll(geminiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	envContent := "GOOGLE_GEMINI_BASE_URL=" + srv.URL + "\nGEMINI_API_KEY=\"tok-gemini-secret\"\n"
	if err := os.WriteFile(filepath.Join(geminiDir, ".env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	native := []agenttypes.ModelInfo{{ID: "gemini-2.5-pro", Name: "Gemini 2.5 Pro"}}
	got := SupplementActiveRelayModels(context.Background(), "gemini", Definition{
		Name: "gemini",
		Env:  map[string]string{"HOME": home},
	}, native)

	if seenHeader != "tok-gemini-secret" {
		t.Fatalf("x-goog-api-key = %q, want tok-gemini-secret", seenHeader)
	}
	if seenQuery != "" {
		t.Fatalf("Gemini request must not send credentials in query string, got %q", seenQuery)
	}
	want := []agenttypes.ModelInfo{
		native[0],
		{ID: "relay-gemini-extra", Name: "relay-gemini-extra"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("models = %+v, want %+v", got, want)
	}
}

func TestDiscoverActiveRelayEndpointAllAgents(t *testing.T) {
	writeFile := func(t *testing.T, path, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		name      string
		agentName string
		setup     func(t *testing.T, home string) map[string]string
		want      RelayEndpoint
	}{
		{
			name:      "copilot-anthropic",
			agentName: "copilot",
			setup: func(_ *testing.T, _ string) map[string]string {
				return map[string]string{
					"COPILOT_PROVIDER_BASE_URL": "https://relay.example.com",
					"COPILOT_PROVIDER_API_KEY":  "tok-copilot",
					"COPILOT_PROVIDER_TYPE":     "anthropic",
				}
			},
			want: RelayEndpoint{BaseURL: "https://relay.example.com", APIKey: "tok-copilot", Protocol: RelayProtocolAnthropic},
		},
		{
			name:      "qwen-settings",
			agentName: "qwen",
			setup: func(t *testing.T, home string) map[string]string {
				writeFile(t, filepath.Join(home, ".qwen", "settings.json"), `{
					"env": {"QWEN_KEY": "tok-qwen"},
					"modelProviders": {
						"openai": {
							"protocol": "openai",
							"models": [{"baseUrl": "https://qwen-relay.example.com/v1", "envKey": "QWEN_KEY"}]
						}
					}
				}`)
				return map[string]string{"HOME": home}
			},
			want: RelayEndpoint{BaseURL: "https://qwen-relay.example.com/v1", APIKey: "tok-qwen", Protocol: RelayProtocolOpenAI},
		},
		{
			name:      "kimi-config",
			agentName: "kimi",
			setup: func(t *testing.T, home string) map[string]string {
				writeFile(t, filepath.Join(home, ".kimi", "config.toml"), `
default_model = "main"
[models.main]
provider = "relay"
[providers.relay]
type = "anthropic"
base_url = "https://kimi-relay.example.com"
api_key = "tok-kimi"
`)
				return map[string]string{"HOME": home}
			},
			want: RelayEndpoint{BaseURL: "https://kimi-relay.example.com", APIKey: "tok-kimi", Protocol: RelayProtocolAnthropic},
		},
		{
			name:      "opencode-json",
			agentName: "opencode",
			setup: func(t *testing.T, home string) map[string]string {
				writeFile(t, filepath.Join(home, ".config", "opencode", "opencode.json"), `{
					"model": "myrelay/claude-sonnet-4-6",
					"provider": {
						"myrelay": {
							"npm": "@ai-sdk/anthropic",
							"options": {"baseURL": "https://opencode-relay.example.com", "apiKey": "tok-opencode"}
						}
					}
				}`)
				return map[string]string{"HOME": home}
			},
			want: RelayEndpoint{BaseURL: "https://opencode-relay.example.com", APIKey: "tok-opencode", Protocol: RelayProtocolAnthropic},
		},
		{
			name:      "openclaw-json",
			agentName: "openclaw",
			setup: func(t *testing.T, home string) map[string]string {
				writeFile(t, filepath.Join(home, ".openclaw", "openclaw.json"), `{
					"agents": {"defaults": {"model": {"primary": "gw/gpt-5.4"}}},
					"models": {"providers": {"gw": {"baseUrl": "https://openclaw-relay.example.com/v1", "apiKey": "tok-openclaw", "api": "openai-responses"}}}
				}`)
				return map[string]string{"HOME": home}
			},
			want: RelayEndpoint{BaseURL: "https://openclaw-relay.example.com/v1", APIKey: "tok-openclaw", Protocol: RelayProtocolOpenAI},
		},
		{
			name:      "omp-yaml",
			agentName: "omp",
			setup: func(t *testing.T, home string) map[string]string {
				writeFile(t, filepath.Join(home, ".omp", "agent", "models.yml"), `
modelRoles:
  main: custom/gemini-2.5-pro
providers:
  custom:
    baseUrl: https://omp-relay.example.com
    apiKey: tok-omp
    api: google-gemini
`)
				return map[string]string{"HOME": home}
			},
			want: RelayEndpoint{BaseURL: "https://omp-relay.example.com", APIKey: "tok-omp", Protocol: RelayProtocolGemini},
		},
		{
			name:      "pi-json",
			agentName: "pi",
			setup: func(t *testing.T, home string) map[string]string {
				writeFile(t, filepath.Join(home, ".pi", "agent", "settings.json"), `{"defaultProvider": "relay1"}`)
				writeFile(t, filepath.Join(home, ".pi", "agent", "models.json"), `{
					"providers": {"relay1": {"baseUrl": "https://pi-relay.example.com/v1", "apiKey": "tok-pi", "api": "openai"}}
				}`)
				return map[string]string{"HOME": home}
			},
			want: RelayEndpoint{BaseURL: "https://pi-relay.example.com/v1", APIKey: "tok-pi", Protocol: RelayProtocolOpenAI},
		},
		{
			name:      "hermes-yaml",
			agentName: "hermes",
			setup: func(t *testing.T, home string) map[string]string {
				writeFile(t, filepath.Join(home, ".hermes", "config.yaml"), `
model:
  base_url: https://hermes-relay.example.com/v1
  api_key: tok-hermes
`)
				return map[string]string{"HOME": home}
			},
			want: RelayEndpoint{BaseURL: "https://hermes-relay.example.com/v1", APIKey: "tok-hermes", Protocol: RelayProtocolOpenAI},
		},
		{
			name:      "generic-env-fallback",
			agentName: "custom-agent",
			setup: func(_ *testing.T, _ string) map[string]string {
				return map[string]string{
					"OPENAI_BASE_URL": "https://generic-relay.example.com/v1",
					"OPENAI_API_KEY":  "tok-generic",
				}
			},
			want: RelayEndpoint{BaseURL: "https://generic-relay.example.com/v1", APIKey: "tok-generic", Protocol: RelayProtocolOpenAI},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			env := tc.setup(t, home)
			got, ok := DiscoverActiveRelayEndpoint(tc.agentName, Definition{Name: tc.agentName, Env: env})
			if !ok {
				t.Fatalf("DiscoverActiveRelayEndpoint(%q) returned ok=false", tc.agentName)
			}
			if got != tc.want {
				t.Fatalf("endpoint = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestSanitizeRelayErrorStripsQueryAndUserinfo(t *testing.T) {
	raw := &url.Error{
		Op:  "Get",
		URL: "https://user:pass@relay.example.com/v1beta/models?key=super-secret-token",
		Err: errors.New("connection refused"),
	}
	cleaned := sanitizeRelayError(raw)
	msg := cleaned.Error()
	if strings.Contains(msg, "super-secret-token") || strings.Contains(msg, "pass") {
		t.Fatalf("sanitized error leaked credentials: %s", msg)
	}
	if !strings.Contains(msg, "https://relay.example.com/v1beta/models") {
		t.Fatalf("sanitized error lost safe URL: %s", msg)
	}
}

func TestSupplementActiveRelayModelsSkipsOfficialEndpointsAndFailureKeepsNative(t *testing.T) {
	var hits atomic.Int32
	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		http.Error(w, "unavailable", http.StatusBadGateway)
	}))
	defer failing.Close()

	native := []agenttypes.ModelInfo{{ID: "native-1", Name: "Native 1", SupportEffort: true, Efforts: []string{"high"}}}

	if _, ok := DiscoverActiveRelayEndpoint("claude", Definition{
		Name: "claude",
		Env: map[string]string{
			"ANTHROPIC_BASE_URL":   "https://api.anthropic.com",
			"ANTHROPIC_AUTH_TOKEN": "secret",
		},
	}); ok {
		t.Fatal("official api.anthropic.com should not be treated as a custom relay")
	}

	got := SupplementActiveRelayModels(context.Background(), "claude", Definition{
		Name: "claude",
		Env: map[string]string{
			"ANTHROPIC_BASE_URL":   failing.URL,
			"ANTHROPIC_AUTH_TOKEN": "secret",
		},
	}, native)
	if hits.Load() == 0 {
		t.Fatal("expected relay fetch attempt")
	}
	if !reflect.DeepEqual(got, native) {
		t.Fatalf("models = %+v, want unchanged native %+v", got, native)
	}
}
