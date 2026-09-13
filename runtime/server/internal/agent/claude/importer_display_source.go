package claude

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Resolve child history only for display; do not add synthetic child IDs to the
// canonical importer index or change native session resume behavior.
func (i *Importer) resolveClaudeDisplaySessionFile(ctx context.Context, targetID, rootPath string) (claudeSessionFile, bool, error) {
	if !strings.HasPrefix(targetID, "claude-subagent:") {
		return i.resolveClaudeSessionFile(targetID, rootPath)
	}
	childID := strings.TrimPrefix(targetID, "claude-subagent:")
	if strings.TrimSpace(childID) == "" {
		return claudeSessionFile{}, false, errors.New("subagent id required")
	}
	parents, err := i.scanSessionFiles(ctx, rootPath, time.Time{}, time.Time{}, int(^uint(0)>>1), nil)
	if err != nil {
		return claudeSessionFile{}, false, err
	}
	var found claudeSessionFile
	for _, parent := range parents {
		if err := ctx.Err(); err != nil {
			return claudeSessionFile{}, false, err
		}
		dir := filepath.Join(strings.TrimSuffix(parent.Path, filepath.Ext(parent.Path)), "subagents")
		entries, err := os.ReadDir(dir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return claudeSessionFile{}, false, err
		}
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".jsonl" {
				continue
			}
			path := filepath.Join(dir, entry.Name())
			id, err := inspectClaudeSubagentID(path)
			if err != nil {
				return claudeSessionFile{}, false, err
			}
			if id != childID {
				continue
			}
			if found.Path != "" && found.Path != path {
				return claudeSessionFile{}, false, errors.New("ambiguous native subagent history")
			}
			found = claudeSessionFile{Path: path, AgentSessionID: targetID, Cwd: parent.Cwd}
		}
	}
	return found, found.Path != "", nil
}
