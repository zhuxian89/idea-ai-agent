package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func exportTransferProviders(sections map[string]json.RawMessage, selected map[string]bool) error {
	providers, err := readAgentAPIProviders()
	if err != nil {
		return err
	}
	if providers == nil {
		providers = []agentAPIProvider{}
	}
	keys := map[string]string{}
	for i := range providers {
		if providers[i].APIKey != "" {
			keys[providers[i].ID] = providers[i].APIKey
		}
		providers[i].APIKey = ""
	}
	if selected["providers"] {
		sections["providers"], err = json.Marshal(providers)
		if err != nil {
			return err
		}
	}
	if selected["api_keys"] {
		sections["api_keys"], err = json.Marshal(keys)
	}
	return err
}

func importTransferProviders(plan *configImportPlan, sections map[string]json.RawMessage, selected map[string]bool) error {
	var incoming []agentAPIProvider
	if selected["providers"] {
		if err := decodeTransfer(sections["providers"], &incoming); err != nil {
			return err
		}
	}
	keys := map[string]string{}
	if selected["api_keys"] {
		if err := decodeTransfer(sections["api_keys"], &keys); err != nil {
			return err
		}
	}
	current, err := readAgentAPIProviders()
	if err != nil {
		return err
	}
	byID, byName := map[string]int{}, map[string]int{}
	for i, item := range current {
		byID[item.ID], byName[strings.ToLower(item.Name)] = i, i
	}
	seenIDs, seenNames := map[string]bool{}, map[string]bool{}
	matched := map[int]bool{}
	for _, item := range incoming {
		item.Name = strings.TrimSpace(item.Name)
		name := strings.ToLower(item.Name)
		if !validTransferSegment(item.ID) || item.Name == "" || strings.ContainsAny(item.Name, `/\`) ||
			seenIDs[item.ID] || seenNames[name] || item.APIKey != "" {
			return errors.New("invalid provider (keys must be in api_keys)")
		}
		seenIDs[item.ID], seenNames[name] = true, true
		item.BaseURL, err = normalizeAPIProviderBaseURL(item.BaseURL)
		if err != nil {
			return err
		}
		item.Protocols = agentAPIProviderProtocols(item)
		key, hasKey := keys[item.ID]
		delete(keys, item.ID)
		position, exists := byID[item.ID]
		if other, ok := byName[name]; ok {
			if exists && position != other {
				return fmt.Errorf("provider %q matches different existing IDs and names", item.Name)
			}
			position, exists = other, true
		}
		if exists {
			if matched[position] {
				return fmt.Errorf("more than one imported provider matches %q", current[position].Name)
			}
			matched[position] = true
			previous := current[position]
			plan.overwrites = true
			// Keep the target ID referenced by its selected Agent configuration.
			item.ID = previous.ID
			if item.BaseURL == previous.BaseURL {
				item.APIKey = previous.APIKey
			}
		}
		if hasKey {
			item.APIKey = key
		}
		if !exists {
			current = append(current, item)
		} else {
			current[position] = item
		}
	}
	for id, key := range keys {
		position, ok := byID[id]
		if !ok {
			return fmt.Errorf("API key has no matching provider %q; also select API provider profiles", id)
		}
		if matched[position] {
			return fmt.Errorf("API key for %q conflicts with an imported provider", id)
		}
		item := &current[position]
		if item.APIKey == key {
			continue
		}
		if item.APIKey != "" {
			plan.overwrites = true
		}
		item.APIKey = key
	}
	file, err := agentAPIProvidersPath()
	if err != nil {
		return err
	}
	return plan.put(file, current)
}
