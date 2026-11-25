package preferences

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
)

func TestApplyAgentDefaultsSupplementsBoundAPIProviderModelsLive(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("IDE_AGENT_DATA_DIR", dataDir)

	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		requests.Add(1)
	}))
	defer upstream.Close()

	store, err := NewStore()
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if err := store.UpdateAgentLastConfigSelection("claude", LastConfigSelection{
		Type: "api_provider",
		ID:   "api-anthropic",
		Name: "Anthropic Relay",
	}); err != nil {
		t.Fatalf("UpdateAgentLastConfigSelection(claude): %v", err)
	}
	if err := store.UpdateAgentLastConfigSelection("codex", LastConfigSelection{
		Type: "api_provider",
		ID:   "api-openai",
		Name: "OpenAI Relay",
	}); err != nil {
		t.Fatalf("UpdateAgentLastConfigSelection(codex): %v", err)
	}

	if err := WriteAPIProviders([]APIProvider{
		{
			ID:        "api-anthropic",
			Name:      "Anthropic Relay",
			BaseURL:   upstream.URL,
			Protocols: []string{APIProviderProtocolAnthropicCompatible},
			Models:    []string{"claude-native", " glm-5 ", "", "glm-5", "deepseek-v3"},
		},
		{
			ID:        "api-openai",
			Name:      "OpenAI Relay",
			BaseURL:   upstream.URL,
			Protocols: []string{APIProviderProtocolOpenAICompatible},
			Models:    []string{"codex-native", "qwen-coder"},
		},
	}); err != nil {
		t.Fatalf("WriteAPIProviders: %v", err)
	}

	claudeNative := agenttypes.ModelInfo{
		ID:            "claude-native",
		Name:          "Claude Native",
		Description:   "Native metadata",
		SupportEffort: true,
		Efforts:       []string{"low", "medium", "high"},
	}
	codexNative := agenttypes.ModelInfo{
		ID:            "codex-native",
		Name:          "Codex Native",
		Description:   "Native codex metadata",
		Hidden:        true,
		SupportEffort: true,
		Efforts:       []string{"high"},
	}
	cachedProbeStatuses := []agent.Status{
		{Name: "claude", Protocol: agent.ProtocolClaudeSDK, Models: []agenttypes.ModelInfo{claudeNative}},
		{Name: "codex", Protocol: agent.ProtocolCodexSDK, Models: []agenttypes.ModelInfo{codexNative}},
		{Name: "gemini", Protocol: agent.ProtocolACP, Models: []agenttypes.ModelInfo{{ID: "gemini-native", Name: "Gemini"}}},
	}

	got := store.ApplyAgentDefaults(cachedProbeStatuses)

	// Cached probe slice must remain pure native models.
	if len(cachedProbeStatuses[0].Models) != 1 || len(cachedProbeStatuses[1].Models) != 1 {
		t.Fatalf("probe cache was mutated: %+v", cachedProbeStatuses)
	}

	wantClaude := []agenttypes.ModelInfo{
		claudeNative,
		{ID: "glm-5", Name: "glm-5"},
		{ID: "deepseek-v3", Name: "deepseek-v3"},
	}
	if !reflect.DeepEqual(got[0].Models, wantClaude) {
		t.Fatalf("claude models = %+v, want %+v", got[0].Models, wantClaude)
	}

	wantCodex := []agenttypes.ModelInfo{
		codexNative,
		{ID: "qwen-coder", Name: "qwen-coder"},
	}
	if !reflect.DeepEqual(got[1].Models, wantCodex) {
		t.Fatalf("codex models = %+v, want %+v", got[1].Models, wantCodex)
	}

	// ACP agents are untouched.
	if len(got[2].Models) != 1 || got[2].Models[0].ID != "gemini-native" {
		t.Fatalf("acp agent models changed: %+v", got[2].Models)
	}
	if requests.Load() != 0 {
		t.Fatalf("unexpected network requests: %d", requests.Load())
	}

	// Syncing/updating api-providers.json or deleting a provider immediately
	// changes ApplyAgentDefaults output without re-probing.
	if err := WriteAPIProviders([]APIProvider{
		{
			ID:        "api-anthropic",
			Protocols: []string{APIProviderProtocolAnthropicCompatible},
			Models:    []string{"kimi-k2"},
		},
	}); err != nil {
		t.Fatalf("WriteAPIProviders(sync): %v", err)
	}
	afterSync := store.ApplyAgentDefaults(cachedProbeStatuses)
	if len(afterSync[0].Models) != 2 || afterSync[0].Models[1].ID != "kimi-k2" {
		t.Fatalf("claude models after sync = %+v", afterSync[0].Models)
	}
	if len(afterSync[1].Models) != 1 || afterSync[1].Models[0].ID != "codex-native" {
		t.Fatalf("codex models after provider delete = %+v", afterSync[1].Models)
	}

	// Switching selection back to a config backup drops provider models immediately.
	if err := store.UpdateAgentLastConfigSelection("claude", LastConfigSelection{
		Type: "backup",
		ID:   "backup-1",
		Name: "Default Backup",
	}); err != nil {
		t.Fatalf("UpdateAgentLastConfigSelection(backup): %v", err)
	}
	afterBackup := store.ApplyAgentDefaults(cachedProbeStatuses)
	if !reflect.DeepEqual(afterBackup[0].Models, []agenttypes.ModelInfo{claudeNative}) {
		t.Fatalf("claude models after switching to backup = %+v", afterBackup[0].Models)
	}

	// Corrupt api-providers.json preserves native models cleanly.
	if err := os.WriteFile(filepath.Join(dataDir, apiProvidersFileName), []byte("{"), 0o600); err != nil {
		t.Fatalf("corrupt api-providers.json: %v", err)
	}
	if err := store.UpdateAgentLastConfigSelection("claude", LastConfigSelection{
		Type: "api_provider",
		ID:   "api-anthropic",
	}); err != nil {
		t.Fatalf("rebind claude: %v", err)
	}
	afterCorrupt := store.ApplyAgentDefaults(cachedProbeStatuses)
	if !reflect.DeepEqual(afterCorrupt[0].Models, []agenttypes.ModelInfo{claudeNative}) {
		t.Fatalf("corrupt provider file altered native list: %+v", afterCorrupt[0].Models)
	}
}
