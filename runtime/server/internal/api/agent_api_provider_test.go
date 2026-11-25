package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/preferences"
)

func TestApplyClaudeAPIProviderReplacesConfiguredEnv(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	configPath := filepath.Join(home, "agents.json")
	t.Setenv("MINDFS_AGENTS_CONFIG", configPath)

	writeJSON(t, configPath, agent.Config{
		Agents: []agent.Definition{
			{
				Name:     "claude",
				Command:  "claude",
				Protocol: agent.ProtocolClaudeSDK,
				Env: map[string]string{
					"ANTHROPIC_AUTH_TOKEN": "old-token",
					"ANTHROPIC_BASE_URL":   "https://old.example.com",
					"ANTHROPIC_API_KEY":    "old-key",
					"ANTHROPIC_MODEL":      "old-model",
					"KEEP_ME":              "unchanged",
				},
				ConfigBackup: agent.ConfigBackupDefaults{
					EnvKeys: []string{
						"ANTHROPIC_AUTH_TOKEN",
						"ANTHROPIC_BASE_URL",
						"ANTHROPIC_API_KEY",
						"ANTHROPIC_MODEL",
					},
				},
			},
		},
	})

	err := applyAgentAPIProvider("claude", agentAPIProvider{
		BaseURL: "https://new.example.com",
		APIKey:  "new-key",
	}, nil)
	if err != nil {
		t.Fatalf("applyAgentAPIProvider: %v", err)
	}

	cfg, err := agent.LoadConfig("")
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	def, ok := cfg.GetAgent("claude")
	if !ok {
		t.Fatal("claude not configured")
	}
	want := map[string]string{
		"ANTHROPIC_BASE_URL":   "https://new.example.com",
		"ANTHROPIC_AUTH_TOKEN": "new-key",
		"KEEP_ME":              "unchanged",
	}
	if !stringMapsEqual(def.Env, want) {
		t.Fatalf("claude env = %#v, want %#v", def.Env, want)
	}
}

func stringMapsEqual(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func TestHandleAgentsListReflectsAPIProviderChangesWithoutReprobe(t *testing.T) {
	t.Setenv("IDE_AGENT_DATA_DIR", t.TempDir())

	prefs, err := preferences.NewStore()
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if err := prefs.UpdateAgentLastConfigSelection("claude", preferences.LastConfigSelection{
		Type: "api_provider",
		ID:   "api-one",
		Name: "One",
	}); err != nil {
		t.Fatalf("UpdateAgentLastConfigSelection: %v", err)
	}
	if err := preferences.WriteAPIProviders([]preferences.APIProvider{{
		ID:        "api-one",
		Name:      "One",
		BaseURL:   "https://gateway.example.com",
		Protocols: []string{preferences.APIProviderProtocolAnthropicCompatible},
		Models:    []string{"claude-sonnet-4-6", "glm-5"},
	}}); err != nil {
		t.Fatalf("WriteAPIProviders: %v", err)
	}

	cfg := agent.Config{Agents: []agent.Definition{{
		Name:     "claude",
		Command:  "claude",
		Protocol: agent.ProtocolClaudeSDK,
	}}}
	prober := agent.NewProber(&cfg, nil, 0)
	prober.ReportSuccess("claude")

	handler := &HTTPHandler{AppContext: &AppContext{
		Prober: prober,
		Prefs:  prefs,
	}}

	fetchModels := func() []agenttypes.ModelInfo {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/agents", nil)
		rec := httptest.NewRecorder()
		handler.handleAgentsList(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Agents []agent.Status `json:"agents"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode /api/agents: %v", err)
		}
		if len(body.Agents) != 1 {
			t.Fatalf("agents = %+v", body.Agents)
		}
		return body.Agents[0].Models
	}

	initial := fetchModels()
	wantInitial := []agenttypes.ModelInfo{
		{ID: "claude-sonnet-4-6", Name: "claude-sonnet-4-6"},
		{ID: "glm-5", Name: "glm-5"},
	}
	if !reflect.DeepEqual(initial, wantInitial) {
		t.Fatalf("initial /api/agents models = %+v, want %+v", initial, wantInitial)
	}

	// Delete the bound provider without triggering any new probe: /api/agents must immediately stop returning provider models.
	delReq := httptest.NewRequest(http.MethodDelete, "/api/agents/api-providers?id=api-one", nil)
	delRec := httptest.NewRecorder()
	handler.handleAgentAPIProviderDelete(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body = %s", delRec.Code, delRec.Body.String())
	}

	afterDelete := fetchModels()
	if len(afterDelete) != 0 {
		t.Fatalf("after delete /api/agents models = %+v, want empty", afterDelete)
	}
}
