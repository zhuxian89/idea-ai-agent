package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/pelletier/go-toml/v2"

	"mindfs/server/internal/agent"
	"mindfs/server/internal/apperr"
)

// Capture the active files directly into the v1 archive. Export never creates a named backup on the source node.
func exportCurrentAgentConfigs(cfg agent.Config, selected []string) (json.RawMessage, error) {
	if len(selected) == 0 {
		return nil, errors.New("select at least one Agent")
	}
	bundle := transferBackups{Env: map[string][]string{}, Files: map[string][]byte{}}
	now := time.Now().UTC().Format(time.RFC3339)
	size := 0
	seen := map[string]bool{}
	for _, name := range selected {
		def, ok := cfg.GetAgent(name)
		id := name + "-current"
		if !ok || !validTransferSegment(id) || seen[strings.ToLower(id)] {
			return nil, fmt.Errorf("invalid or duplicate Agent %q", name)
		}
		seen[strings.ToLower(id)] = true
		entry := agentConfigManifestEntry{ID: id, Agent: name, Name: "current", CreatedAt: now, UpdatedAt: now}
		env := map[string]string{}
		maps.Copy(env, def.Env)
		keys := slices.Clone(def.ConfigBackup.EnvKeys)
		sources := slices.Clone(def.ConfigBackup.FileSources)
		if name == "codex" {
			sources = append(sources, "~/.codex/config.toml", "~/.codex/auth.json")
			keys = append(keys, "OPENAI_API_KEY")
		}
		seenPaths := map[string]bool{}
		for _, source := range sources {
			file, err := expandUserPath(source)
			if err != nil {
				return nil, err
			}
			if file == "" {
				continue
			}
			dest, err := portableTransferDestination(file)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", name, err)
			}
			if seenPaths[dest] {
				continue
			}
			seenPaths[dest] = true
			if name == "codex" && isPortableCodexFile(dest) {
				if dir := codexConfigHome(def.Env); dir != "" {
					file = filepath.Join(dir, filepath.Base(file))
				}
			}
			content, err := readTransferBytes(file)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return nil, fmt.Errorf("%s: %s: %w", name, file, err)
			}
			size += len(content)
			if size > (transferMaxBytes*3/4)-(64<<10) {
				return nil, errors.New("Agent configuration exceeds archive size limit")
			}
			if name == "codex" && dest == "~/.codex/config.toml" {
				referencedKeys, err := codexProviderEnvKeys(content)
				if err != nil {
					return nil, err
				}
				keys = append(keys, referencedKeys...)
			}
			path := fmt.Sprintf("%s/%03d-%s", id, len(entry.Sources)+1, filepath.Base(file))
			entry.Sources = append(entry.Sources, agentConfigSource{SourcePath: dest, BackupPath: path})
			bundle.Files[path] = content
		}
		for _, key := range keys {
			if _, configured := env[key]; !configured && key != "" {
				if v := os.Getenv(key); v != "" {
					env[key] = v
				}
			}
		}
		if name == "codex" {
			delete(env, "CODEX_HOME")
		}
		for _, key := range slices.Sorted(maps.Keys(env)) {
			if env[key] != "" {
				entry.EnvKeys = append(entry.EnvKeys, key)
				bundle.Env[id] = append(bundle.Env[id], key+"="+env[key])
			}
		}
		if len(entry.Sources) == 0 && len(entry.EnvKeys) == 0 {
			return nil, &apperr.Error{Code: "config.no_current_agent_config", Message: "No exportable configuration found for " + name, Detail: name}
		}
		bundle.Manifest = append(bundle.Manifest, entry)
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		return nil, err
	}
	return marshalConfigArchive(map[string]json.RawMessage{"agent_backups": raw})
}

func codexConfigHome(env map[string]string) string {
	if value, ok := env["CODEX_HOME"]; ok {
		return value
	}
	return os.Getenv("CODEX_HOME")
}

func isPortableCodexFile(dest string) bool {
	return dest == "~/.codex/config.toml" || dest == "~/.codex/auth.json"
}

func codexProviderEnvKeys(content []byte) ([]string, error) {
	var config struct {
		Providers map[string]struct {
			EnvKey         string            `toml:"env_key"`
			EnvHTTPHeaders map[string]string `toml:"env_http_headers"`
		} `toml:"model_providers"`
	}
	if err := toml.Unmarshal(content, &config); err != nil {
		return nil, errors.New("invalid TOML in Codex config.toml")
	}
	var keys []string
	for _, provider := range config.Providers {
		keys = append(keys, provider.EnvKey)
		for _, key := range provider.EnvHTTPHeaders {
			keys = append(keys, key)
		}
	}
	return keys, nil
}
