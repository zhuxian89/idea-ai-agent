package claude

import (
	"context"
	"encoding/json"
	"errors"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/apperr"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func readClaudeImportedSubagents(parentPath string) ([]agenttypes.ImportedSubagentSession, error) {
	dir := filepath.Join(strings.TrimSuffix(parentPath, filepath.Ext(parentPath)), "subagents")
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, apperr.Wrap("read_dir", dir, err)
	}
	pathsByAgentID := make(map[string]string)
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".jsonl" {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		agentID, err := inspectClaudeSubagentID(path)
		if err != nil {
			return nil, err
		}
		if agentID != "" {
			pathsByAgentID[agentID] = path
		}
	}
	if len(pathsByAgentID) == 0 {
		return nil, nil
	}
	relations := make(map[string]claudeSubagentRelation)
	if err := collectClaudeSubagentRelations(parentPath, "", relations); err != nil {
		return nil, err
	}
	for agentID, path := range pathsByAgentID {
		if err := collectClaudeSubagentRelations(path, agentID, relations); err != nil {
			return nil, err
		}
	}
	items := make([]agenttypes.ImportedSubagentSession, 0, len(relations))
	remaining := make(map[string]claudeSubagentRelation, len(relations))
	for agentID, relation := range relations {
		if _, ok := pathsByAgentID[agentID]; ok {
			remaining[agentID] = relation
		}
	}
	added := make(map[string]bool)
	for len(remaining) > 0 {
		progressed := false
		for agentID, relation := range remaining {
			if relation.ParentAgentID != "" && !added[relation.ParentAgentID] {
				continue
			}
			exchanges, err := readClaudeImportedExchanges(pathsByAgentID[agentID], time.Time{})
			if err != nil {
				return nil, err
			}
			parentID := ""
			if relation.ParentAgentID != "" {
				parentID = "claude-subagent:" + relation.ParentAgentID
			}
			items = append(items, agenttypes.ImportedSubagentSession{
				AgentSessionID:       "claude-subagent:" + agentID,
				ParentAgentSessionID: parentID,
				ParentToolCallID:     relation.ParentToolCallID,
				Title:                relation.Title,
				Model:                relation.Model,
				Exchanges:            exchanges,
			})
			added[agentID] = true
			delete(remaining, agentID)
			progressed = true
		}
		if !progressed {
			break
		}
	}
	return items, nil
}

func inspectClaudeSubagentID(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", apperr.Wrap("open", path, err)
	}
	defer file.Close()
	var agentID string
	err = forEachJSONLLine(file, func(line string) error {
		var raw map[string]any
		if json.Unmarshal([]byte(line), &raw) == nil {
			agentID = strings.TrimSpace(asString(raw["agentId"]))
		}
		if agentID != "" {
			return errStopJSONL
		}
		return nil
	})
	if errors.Is(err, errStopJSONL) {
		err = nil
	}
	return agentID, err
}

func collectClaudeSubagentRelations(path, parentAgentID string, relations map[string]claudeSubagentRelation) error {
	file, err := os.Open(path)
	if err != nil {
		return apperr.Wrap("open", path, err)
	}
	defer file.Close()
	callDetails := make(map[string]claudeSubagentRelation)
	return forEachJSONLLine(file, func(line string) error {
		var raw map[string]any
		if json.Unmarshal([]byte(line), &raw) != nil {
			return nil
		}
		message, _ := raw["message"].(map[string]any)
		blocks, _ := message["content"].([]any)
		for _, value := range blocks {
			block, _ := value.(map[string]any)
			if block == nil {
				continue
			}
			toolName := strings.ToLower(strings.TrimSpace(asString(block["name"])))
			if strings.EqualFold(asString(block["type"]), "tool_use") && (toolName == "agent" || toolName == "task") {
				input, _ := block["input"].(map[string]any)
				callID := strings.TrimSpace(asString(block["id"]))
				callDetails[callID] = claudeSubagentRelation{
					ParentAgentID:    parentAgentID,
					ParentToolCallID: callID,
					Title:            firstNonEmpty(asString(input["description"]), asString(input["subagent_type"]), "Subagent"),
					Model:            strings.TrimSpace(asString(input["model"])),
				}
			}
		}
		result, _ := raw["toolUseResult"].(map[string]any)
		agentID := strings.TrimSpace(asString(result["agentId"]))
		if agentID == "" {
			return nil
		}
		callID := ""
		for _, value := range blocks {
			block, _ := value.(map[string]any)
			if block != nil && strings.EqualFold(asString(block["type"]), "tool_result") {
				callID = strings.TrimSpace(asString(block["tool_use_id"]))
				break
			}
		}
		relation := callDetails[callID]
		relation.AgentID = agentID
		relation.ParentAgentID = parentAgentID
		relation.ParentToolCallID = callID
		if relation.Title == "" {
			relation.Title = firstNonEmpty(asString(result["agentType"]), "Subagent")
		}
		if relation.Model == "" {
			relation.Model = strings.TrimSpace(asString(result["resolvedModel"]))
		}
		relations[agentID] = relation
		return nil
	})
}

func (i *Importer) ResolveForkPointByAgentTurnIndex(ctx context.Context, in agenttypes.ResolveForkPointInput) (agenttypes.ResolveForkPointOutput, error) {
	rootPath := normalizeComparablePath(in.RootPath)
	if rootPath == "" {
		return agenttypes.ResolveForkPointOutput{}, errors.New("root path required")
	}
	targetID := strings.TrimSpace(in.AgentSessionID)
	if targetID == "" {
		return agenttypes.ResolveForkPointOutput{}, errors.New("agent session id required")
	}
	if in.AgentTurnIndex <= 0 {
		return agenttypes.ResolveForkPointOutput{}, errors.New("agent turn index required")
	}
	file, ok := i.lookupSessionFile(targetID, rootPath)
	if !ok {
		files, err := i.scanSessionFiles(ctx, rootPath, time.Time{}, time.Time{}, int(^uint(0)>>1), nil)
		if err != nil {
			return agenttypes.ResolveForkPointOutput{}, err
		}
		for _, candidate := range files {
			if candidate.AgentSessionID == targetID {
				file = candidate
				ok = true
				break
			}
		}
	}
	if !ok {
		return agenttypes.ResolveForkPointOutput{}, errors.New("external session not found")
	}
	items, err := readClaudeImportedExchangeLocators(file.Path, time.Time{})
	if err != nil {
		return agenttypes.ResolveForkPointOutput{}, err
	}
	turns := buildImportedTurns(items)
	if in.AgentTurnIndex > len(turns) {
		return agenttypes.ResolveForkPointOutput{}, errors.New("agent turn index out of range")
	}
	agent := turns[in.AgentTurnIndex-1].Agent
	if strings.TrimSpace(agent.ClaudeLastMessageUUID) == "" {
		return agenttypes.ResolveForkPointOutput{}, errors.New("claude message uuid not found")
	}
	return agenttypes.ResolveForkPointOutput{
		Kind:              agenttypes.ForkPointClaudeMessageUUID,
		AgentSessionID:    targetID,
		ClaudeMessageUUID: agent.ClaudeLastMessageUUID,
	}, nil
}
