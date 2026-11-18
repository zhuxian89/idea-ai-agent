package api

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mindfs/server/internal/agent"
)

func transferTestConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("IDE_AGENT_DATA_DIR", dir)
	t.Setenv("MINDFS_AGENTS_CONFIG", "")
	t.Setenv("CODEX_HOME", "")
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	return dir
}

func transferTestJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func transferTestWrite(t *testing.T, name, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestAgentConfigurationTransferRoundTrip(t *testing.T) {
	source := transferTestConfigDir(t)
	configFile := filepath.Join(source, ".codex", "config.toml")
	transferTestWrite(t, configFile, "model = 'example'")
	backup, err := createAgentConfigBackup(agentConfigBackupRequest{
		Agent: "codex", Name: "portable", FileSources: []string{configFile}, EnvLines: []string{"EXAMPLE=checked"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := writeAgentAPIProviders([]agentAPIProvider{{
		ID: "api-portable", Name: "Portable", BaseURL: "https://example.com", APIKey: "example-secret",
	}}); err != nil {
		t.Fatal(err)
	}
	transferTestWrite(t, filepath.Join(source, "agents.json"), `{"agents":[{"name":"portable","command":"demo"}],"relayBaseURL":"https://source.example"}`)
	selected := map[string]bool{"agent_backups": true, "providers": true, "custom_agents": true}
	raw, err := exportAgentConfiguration(selected)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "example-secret") || strings.Contains(string(raw), "source.example") {
		t.Fatal("ordinary export exposed an unselected key or device setting")
	}
	selected["api_keys"] = true
	raw, err = exportAgentConfiguration(selected)
	if err != nil {
		t.Fatal(err)
	}
	var archive configArchive
	if err := json.Unmarshal(raw, &archive); err != nil {
		t.Fatal(err)
	}
	var bundle transferBackups
	if err := json.Unmarshal(archive.Sections["agent_backups"], &bundle); err != nil {
		t.Fatal(err)
	}
	if got := bundle.Manifest[0].Sources[0].SourcePath; got != "~/.codex/config.toml" {
		t.Fatalf("non-portable target: %s", got)
	}

	target := transferTestConfigDir(t)
	existingFile := filepath.Join(target, "agents.json")
	transferTestWrite(t, existingFile, `{"agents":[{"name":"local-existing","command":"local"}],"relayBaseURL":"https://target.example"}`)
	if err := writeAgentAPIProviders([]agentAPIProvider{{
		ID: "api-local", Name: "Portable", BaseURL: "https://destination.example", APIKey: "local-key",
	}}); err != nil {
		t.Fatal(err)
	}
	newProvider := configImportRequest{
		Categories: []string{"providers"}, Archive: configArchive{
			Format: transferFormat, Version: 1,
			Sections: map[string]json.RawMessage{"providers": transferTestJSON(t, []agentAPIProvider{{
				ID: "api-retain", Name: "Other", BaseURL: "https://other.example",
			}})},
		},
	}
	if result, err := importAgentConfiguration(newProvider); err != nil || result.NeedsConfirm {
		t.Fatalf("new provider should import immediately: %+v, %v", result, err)
	}
	req := configImportRequest{Archive: archive, Categories: []string{"agent_backups", "custom_agents", "providers", "api_keys"}}
	result, err := importAgentConfiguration(req)
	if err != nil || !result.NeedsConfirm || len(result.Backups) != 0 {
		t.Fatalf("expected matching provider to require a choice: %+v, %v", result, err)
	}
	if items, err := readAgentConfigManifest(); err != nil || len(items) != 0 {
		t.Fatalf("a conflict applied changes before confirmation: %v", err)
	}
	req.ConfirmOverwrite = true
	result, err = importAgentConfiguration(req)
	if err != nil || result.NeedsConfirm || !result.RestartRequired {
		t.Fatalf("import: %+v, %v", result, err)
	}
	if len(result.Backups) != 1 || result.Backups[0] != (importedAgentBackup{ID: backup.ID, Agent: "codex", Name: "portable"}) {
		t.Fatalf("expected the imported backup to be available for switching: %+v", result.Backups)
	}
	items, err := readAgentConfigManifest()
	if err != nil || len(items) != 1 || items[0].ID != backup.ID {
		t.Fatalf("imported backups: %v, %v", items, err)
	}
	env, err := readAgentEnvBackups()
	if err != nil || strings.Join(env[backup.ID], ",") != "EXAMPLE=checked" {
		t.Fatalf("imported backup environment: %v", err)
	}
	providers, err := readAgentAPIProviders()
	if err != nil || len(providers) != 2 || providers[0].ID != "api-local" || providers[0].APIKey != "example-secret" ||
		providers[0].BaseURL != "https://example.com" || providers[1].ID != "api-retain" || providers[1].BaseURL != "https://other.example" {
		t.Fatalf("overwrite must retain target ID and unrelated providers: %v", err)
	}
	data, err := os.ReadFile(existingFile)
	if err != nil || !strings.Contains(string(data), "target.example") || !strings.Contains(string(data), "local-existing") || !strings.Contains(string(data), "portable") {
		t.Fatalf("custom configs were not merged: %v", err)
	}
	targetFile := filepath.Join(target, ".codex", "config.toml")
	if _, err := os.Stat(targetFile); !os.IsNotExist(err) {
		t.Fatal("import applied an active config before selecting it")
	}
	if _, confirm, err := switchAgentConfig(agentConfigSwitchRequest{ID: backup.ID}, nil); err != nil || !confirm {
		t.Fatalf("portable file target requires confirmation: %v, %v", confirm, err)
	}
	if _, confirm, err := switchAgentConfig(agentConfigSwitchRequest{ID: backup.ID, ConfirmOverwrite: true}, nil); err != nil || confirm {
		t.Fatalf("switch imported backup: %v, %v", confirm, err)
	}
	if data, err := os.ReadFile(targetFile); err != nil || string(data) != "model = 'example'" {
		t.Fatalf("imported config was not written to destination home: %v", err)
	}
}

func TestAgentConfigurationTransferRejectsEmptyBackupArchive(t *testing.T) {
	dir := transferTestConfigDir(t)
	if _, err := exportAgentConfiguration(map[string]bool{"agent_backups": true}); !errors.Is(err, errNoTransferBackups) {
		t.Fatalf("exported an empty backup: %v", err)
	}
	req := configImportRequest{Categories: []string{"agent_backups"}, Archive: configArchive{
		Format: transferFormat, Version: 1,
		Sections: map[string]json.RawMessage{"agent_backups": json.RawMessage(`{"manifest":[],"env":{},"files":{}}`)},
	}}
	if _, err := importAgentConfiguration(req); !errors.Is(err, errNoTransferBackups) {
		t.Fatalf("accepted an empty backup archive: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "agents-config")); !os.IsNotExist(err) {
		t.Fatal("empty import wrote backup data")
	}
}

func TestAgentConfigurationTransferRejectsUnsafeBackupDestination(t *testing.T) {
	dir := transferTestConfigDir(t)
	for _, input := range []string{"~/../outside", "../outside", filepath.Join(filepath.Dir(dir), "outside")} {
		t.Run(input, func(t *testing.T) {
			bundle := transferBackups{
				Manifest: []agentConfigManifestEntry{{
					ID: "codex-test", Agent: "codex", Name: "test",
					Sources: []agentConfigSource{{SourcePath: input, BackupPath: "codex-test/config.toml"}},
				}},
				Files: map[string][]byte{"codex-test/config.toml": []byte("untrusted")},
			}
			req := configImportRequest{Categories: []string{"agent_backups"}, Archive: configArchive{
				Format: transferFormat, Version: 1, Sections: map[string]json.RawMessage{"agent_backups": transferTestJSON(t, bundle)},
			}}
			if _, err := importAgentConfiguration(req); err == nil {
				t.Fatal("unsafe destination was accepted")
			}
			if _, err := os.Stat(filepath.Join(dir, "agents-config")); !os.IsNotExist(err) {
				t.Fatal("invalid import wrote backup data")
			}
		})
	}
}

func TestAgentConfigurationTransferRejectsAmbiguousProvider(t *testing.T) {
	transferTestConfigDir(t)
	if err := writeAgentAPIProviders([]agentAPIProvider{{
		ID: "api-local", Name: "Local", BaseURL: "https://local.example",
	}}); err != nil {
		t.Fatal(err)
	}
	profiles := []agentAPIProvider{
		{ID: "api-local", Name: "Renamed", BaseURL: "https://changed.example"},
		{ID: "api-other", Name: "Local", BaseURL: "https://other.example"},
	}
	req := configImportRequest{
		Categories: []string{"providers"}, Archive: configArchive{
			Format: transferFormat, Version: 1,
			Sections: map[string]json.RawMessage{"providers": transferTestJSON(t, profiles)},
		},
	}
	for _, confirm := range []bool{false, true} {
		req.ConfirmOverwrite = confirm
		if _, err := importAgentConfiguration(req); err == nil || !strings.Contains(err.Error(), "more than one imported provider") {
			t.Fatalf("ambiguous match accepted with confirm=%t: %v", confirm, err)
		}
	}
	providers, err := readAgentAPIProviders()
	if err != nil || len(providers) != 1 || providers[0].Name != "Local" || providers[0].BaseURL != "https://local.example" {
		t.Fatalf("ambiguous import modified providers: %v, %v", providers, err)
	}
}

func TestCurrentAgentConfigExportAndSwitch(t *testing.T) {
	source := transferTestConfigDir(t)
	codexDir := filepath.Join(source, "alt-codex")
	t.Setenv("CODEX_HOME", codexDir)
	t.Setenv("CUSTOM_PROVIDER_TOKEN", "test-provider-secret")
	t.Setenv("OPENAI_API_KEY", "inherited")
	t.Setenv("UNRELATED_SECRET", "private-other")
	const config = "[model_providers.demo]\nenv_key = 'CUSTOM_PROVIDER_TOKEN'\n"
	const auth = `{"OPENAI_API_KEY":"fixture-from-disk"}`
	transferTestWrite(t, filepath.Join(codexDir, "config.toml"), config)
	transferTestWrite(t, filepath.Join(codexDir, "auth.json"), auth)
	cfg := agent.Config{Agents: []agent.Definition{
		{Name: "codex", Env: map[string]string{"OPENAI_API_KEY": "configured"}},
		{Name: "claude", Env: map[string]string{"ANTHROPIC_AUTH_TOKEN": "test-claude"}},
		{Name: "other", Env: map[string]string{"PRIVATE": "private-other"}},
		{Name: "empty"},
	}}
	for _, names := range [][]string{nil, {"codex", "empty"}, {"codex", "codex"}, {"missing"}} {
		if result, err := exportCurrentAgentConfigs(cfg, names); err == nil || result != nil {
			t.Fatalf("unexpected successful export for %v", names)
		}
	}
	raw, err := exportCurrentAgentConfigs(cfg, []string{"codex", "claude"})
	if err != nil {
		t.Fatal(err)
	}
	for _, excluded := range []string{source, "private-other", "inherited"} {
		if strings.Contains(string(raw), excluded) {
			t.Fatal("archive includes unrelated environment or source paths")
		}
	}
	if _, err := os.Stat(filepath.Join(source, "agents-config")); !os.IsNotExist(err) {
		t.Fatal("export modified source backups")
	}
	var archive configArchive
	if err := json.Unmarshal(raw, &archive); err != nil {
		t.Fatal(err)
	}
	target := transferTestConfigDir(t)
	targetCodexDir := filepath.Join(target, "target-codex")
	t.Setenv("CODEX_HOME", targetCodexDir)
	req := configImportRequest{Archive: archive, Categories: []string{"agent_backups"}}
	result, err := importAgentConfiguration(req)
	if err != nil || result.NeedsConfirm || len(result.Backups) != 2 {
		t.Fatalf("import: %+v, %v", result, err)
	}
	if repeat, err := importAgentConfiguration(req); err != nil || !repeat.NeedsConfirm {
		t.Fatalf("expected overwrite confirmation: %+v, %v", repeat, err)
	}
	for _, backup := range result.Backups {
		if _, _, err := switchAgentConfig(agentConfigSwitchRequest{ID: backup.ID, ConfirmOverwrite: true}, nil); err != nil {
			t.Fatal(err)
		}
	}
	for file, want := range map[string]string{"config.toml": config, "auth.json": auth} {
		got, err := os.ReadFile(filepath.Join(targetCodexDir, file))
		if err != nil || string(got) != want {
			t.Fatalf("%s was not restored: %v", file, err)
		}
	}
	applied, err := agent.LoadConfig("")
	if err != nil {
		t.Fatal(err)
	}
	codex, _ := applied.GetAgent("codex")
	claude, _ := applied.GetAgent("claude")
	if codex.Env["CUSTOM_PROVIDER_TOKEN"] != "test-provider-secret" || codex.Env["OPENAI_API_KEY"] != "configured" || claude.Env["ANTHROPIC_AUTH_TOKEN"] != "test-claude" {
		t.Fatal("selected agents' credentials were not restored")
	}
}
