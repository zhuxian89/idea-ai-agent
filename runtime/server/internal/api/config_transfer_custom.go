package api

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"mindfs/server/internal/agent"
)

type transferCustomConfiguration struct {
	Agents []agent.Definition `json:"agents,omitempty"`
	Shells []agent.Shell      `json:"shells,omitempty"`
}

func exportTransferCustomAgents(sections map[string]json.RawMessage) error {
	file, err := agent.ResolveConfigPath()
	if err != nil {
		return err
	}
	if err := checkTransferPath(filepath.Dir(file), file); err != nil {
		return err
	}
	data, err := readTransferBytes(file)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var config transferCustomConfiguration
	if err := json.Unmarshal(data, &config); err != nil {
		return err
	}
	if len(config.Agents)+len(config.Shells) != 0 {
		sections["custom_agents"], err = json.Marshal(config)
	}
	return err
}

func importTransferCustomAgents(plan *configImportPlan, raw []byte) error {
	var incoming transferCustomConfiguration
	if err := json.Unmarshal(raw, &incoming); err != nil {
		return err
	}
	if len(incoming.Agents)+len(incoming.Shells) == 0 {
		return errors.New("there are no custom Agents or shells in the archive")
	}
	if _, err := agent.DecodeConfig(raw); err != nil {
		return err
	}
	file, err := agent.ResolveConfigPath()
	if err != nil {
		return err
	}
	if err := checkTransferPath(filepath.Dir(file), file); err != nil {
		return err
	}
	existing := map[string]json.RawMessage{}
	var current transferCustomConfiguration
	data, err := readTransferBytes(file)
	if err == nil {
		if err := json.Unmarshal(data, &existing); err != nil {
			return err
		}
		if err := json.Unmarshal(data, &current); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	agents := map[string]int{}
	for i, item := range current.Agents {
		agents[strings.TrimSpace(item.Name)] = i
	}
	seen := map[string]bool{}
	for _, item := range incoming.Agents {
		name := strings.TrimSpace(item.Name)
		if name == "" || seen[name] {
			return errors.New("invalid or duplicate custom Agent name")
		}
		seen[name] = true
		if i, exists := agents[name]; exists {
			plan.overwrites = true
			current.Agents[i] = item
		} else {
			current.Agents = append(current.Agents, item)
		}
		plan.restart = true
	}
	shells := map[string]int{}
	for i, item := range current.Shells {
		shells[strings.ToLower(strings.TrimSpace(item.Command))] = i
	}
	seen = map[string]bool{}
	for _, item := range incoming.Shells {
		key := strings.ToLower(strings.TrimSpace(item.Command))
		if key == "" || seen[key] {
			return errors.New("invalid or duplicate shell command")
		}
		seen[key] = true
		if i, exists := shells[key]; exists {
			plan.overwrites = true
			current.Shells[i] = item
		} else {
			current.Shells = append(current.Shells, item)
		}
		plan.restart = true
	}
	if !plan.restart {
		return nil
	}
	existing["agents"], err = json.Marshal(current.Agents)
	if err != nil {
		return err
	}
	existing["shells"], err = json.Marshal(current.Shells)
	if err != nil {
		return err
	}
	return plan.put(file, existing)
}
