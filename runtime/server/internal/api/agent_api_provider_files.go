package api

import (
	"encoding/json"
	"fmt"
	"mindfs/server/internal/apperr"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

func tomlDottedTable(parent, key string) string {
	return "[" + parent + "." + tomlKey(key) + "]"
}

func tomlKey(key string) string {
	if isTOMLBareKey(key) {
		return key
	}
	return strconv.Quote(key)
}

func isTOMLBareKey(key string) bool {
	if key == "" {
		return false
	}
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_' || r == '-':
			continue
		default:
			return false
		}
	}
	return true
}

func homePath(parts ...string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(append([]string{home}, parts...)...), nil
}

func writeTextFile(path, text string, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return apperr.Wrap("mkdir", filepath.Dir(path), err)
	}
	return apperr.Wrap("write", path, os.WriteFile(path, []byte(text), perm))
}

func readJSONObject(path string) (map[string]any, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, apperr.Wrap("read", path, err)
	}
	if len(strings.TrimSpace(string(payload))) == 0 {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(payload, &out); err != nil {
		normalized := normalizeJSONLikeConfig(string(payload))
		if normalized == string(payload) {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
		if fallbackErr := json.Unmarshal([]byte(normalized), &out); fallbackErr != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
	}
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

func writeJSONObject(path string, value map[string]any, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return apperr.Wrap("mkdir", filepath.Dir(path), err)
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return apperr.Wrap("write", path, os.WriteFile(path, append(payload, '\n'), perm))
}

func ensureJSONObject(parent map[string]any, key string) map[string]any {
	if child, ok := parent[key].(map[string]any); ok {
		return child
	}
	child := map[string]any{}
	parent[key] = child
	return child
}

func readYAMLMap(path string) (map[string]any, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, apperr.Wrap("read", path, err)
	}
	if len(strings.TrimSpace(string(payload))) == 0 {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := yaml.Unmarshal(payload, &out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

func writeYAMLMap(path string, value map[string]any, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return apperr.Wrap("mkdir", filepath.Dir(path), err)
	}
	payload, err := yaml.Marshal(value)
	if err != nil {
		return err
	}
	return apperr.Wrap("write", path, os.WriteFile(path, payload, perm))
}

func ensureYAMLMap(parent map[string]any, key string) map[string]any {
	return ensureJSONObject(parent, key)
}

func replaceManagedBlock(existing, block, startMarker, endMarker string) string {
	text := strings.TrimRight(strings.ReplaceAll(existing, "\r\n", "\n"), "\n")
	start := strings.Index(text, startMarker)
	if start >= 0 {
		end := strings.Index(text[start:], endMarker)
		if end >= 0 {
			end += start + len(endMarker)
			text = strings.TrimRight(text[:start], "\n") + "\n\n" + strings.TrimLeft(text[end:], "\n")
		}
	}
	block = strings.TrimRight(block, "\n")
	if strings.TrimSpace(text) == "" {
		return block + "\n"
	}
	return strings.TrimRight(text, "\n") + "\n\n" + block + "\n"
}

func upsertNamedYAMLSequence(existing any, name string, entry map[string]any) []any {
	var out []any
	if seq, ok := existing.([]any); ok {
		out = append(out, seq...)
	}
	for i, item := range out {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if objName, _ := obj["name"].(string); objName == name {
			merged := map[string]any{}
			for key, value := range obj {
				merged[key] = value
			}
			for key, value := range entry {
				merged[key] = value
			}
			out[i] = merged
			return out
		}
	}
	return append(out, entry)
}

func replaceNamedYAMLSequenceEntry(existing any, name string, entry map[string]any) []any {
	var out []any
	if seq, ok := existing.([]any); ok {
		out = append(out, seq...)
	}
	for i, item := range out {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if objName, _ := obj["name"].(string); objName == name {
			out[i] = entry
			return out
		}
	}
	return append(out, entry)
}

func parseSimpleEnv(input string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(strings.ReplaceAll(input, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		out[key] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return out
}

func formatSimpleEnv(env map[string]string) string {
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, key := range keys {
		value := strings.TrimSpace(env[key])
		if value == "" {
			continue
		}
		b.WriteString(key)
		b.WriteByte('=')
		b.WriteString(value)
		b.WriteByte('\n')
	}
	return b.String()
}
