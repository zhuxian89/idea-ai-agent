package preferences

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"mindfs/server/internal/agent"
	agenttypes "mindfs/server/internal/agent/types"
	"mindfs/server/internal/apperr"
	"mindfs/server/internal/config"
)

const (
	apiProvidersFileName = "api-providers.json"

	APIProviderProtocolOpenAICompatible    = "openai-compatible"
	APIProviderProtocolAnthropicCompatible = "anthropic-compatible"
	APIProviderProtocolGeminiCompatible    = "gemini-compatible"
)

type APIProvider struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	BaseURL        string   `json:"baseUrl"`
	APIKey         string   `json:"apiKey,omitempty"`
	Protocols      []string `json:"protocols,omitempty"`
	ModelFamilies  []string `json:"modelFamilies"`
	Models         []string `json:"models"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
	ActiveProtocol string   `json:"-"`
}

func APIProvidersPath() (string, error) {
	configDir, err := config.MindFSConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, apiProvidersFileName), nil
}

func NormalizeAPIProviderProtocols(protocols []string) []string {
	seen := make(map[string]bool, len(protocols))
	out := make([]string, 0, len(protocols))
	for _, protocol := range protocols {
		protocol = strings.TrimSpace(protocol)
		if protocol == "" || seen[protocol] {
			continue
		}
		seen[protocol] = true
		out = append(out, protocol)
	}
	return out
}

func ReadAPIProviders() ([]APIProvider, error) {
	path, err := APIProvidersPath()
	if err != nil {
		return nil, err
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []APIProvider{}, nil
		}
		return nil, apperr.Wrap("read", path, err)
	}
	if len(strings.TrimSpace(string(payload))) == 0 {
		return []APIProvider{}, nil
	}
	var providers []APIProvider
	if err := json.Unmarshal(payload, &providers); err != nil {
		return nil, err
	}
	for i := range providers {
		providers[i].Protocols = NormalizeAPIProviderProtocols(providers[i].Protocols)
	}
	return providers, nil
}

func WriteAPIProviders(providers []APIProvider) error {
	path, err := APIProvidersPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return apperr.Wrap("mkdir", filepath.Dir(path), err)
	}
	payload, err := json.MarshalIndent(providers, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return apperr.Wrap("write", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(path)
		if retryErr := os.Rename(tmp, path); retryErr != nil {
			return apperr.Wrap("rename", path, err)
		}
	}
	return nil
}

func (s *Store) SupplementAgentModels(agentName string, protocol agent.Protocol, models []agenttypes.ModelInfo) []agenttypes.ModelInfo {
	if s == nil {
		return models
	}
	name := strings.TrimSpace(agentName)
	if name == "" {
		return models
	}
	requiredProtocol, supported := requiredAPIProviderProtocolForSupplement(name, protocol)
	if !supported {
		return models
	}
	s.mu.RLock()
	var selection *LastConfigSelection
	if s.data.Agents != nil {
		if defaults, ok := s.data.Agents[name]; ok && defaults.LastConfigSelection != nil {
			copied := *defaults.LastConfigSelection
			selection = &copied
		}
	}
	s.mu.RUnlock()
	if selection == nil || selection.Type != "api_provider" || strings.TrimSpace(selection.ID) == "" {
		return models
	}
	providers, err := ReadAPIProviders()
	if err != nil {
		return models
	}
	return appendBoundProviderModels(models, providers, selection.ID, requiredProtocol)
}

func requiredAPIProviderProtocolForSupplement(agentName string, protocol agent.Protocol) (string, bool) {
	if protocol == "" {
		protocol = agent.DefaultProtocol(agentName)
	}
	switch protocol {
	case agent.ProtocolClaudeSDK:
		return APIProviderProtocolAnthropicCompatible, true
	case agent.ProtocolCodexSDK:
		return APIProviderProtocolOpenAICompatible, true
	default:
		return "", false
	}
}

func appendBoundProviderModels(
	models []agenttypes.ModelInfo,
	providers []APIProvider,
	providerID string,
	requiredProtocol string,
) []agenttypes.ModelInfo {
	providerID = strings.TrimSpace(providerID)
	for _, provider := range providers {
		if strings.TrimSpace(provider.ID) != providerID {
			continue
		}
		if requiredProtocol != "" && !providerSupportsProtocol(provider, requiredProtocol) {
			return models
		}
		out := append([]agenttypes.ModelInfo(nil), models...)
		seen := make(map[string]bool, len(out))
		for _, model := range out {
			seen[strings.TrimSpace(model.ID)] = true
		}
		for _, raw := range provider.Models {
			id := strings.TrimSpace(raw)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			// Saved provider model IDs do not advertise native reasoning effort metadata.
			out = append(out, agenttypes.ModelInfo{ID: id, Name: id})
		}
		return out
	}
	return models
}

func providerSupportsProtocol(provider APIProvider, requiredProtocol string) bool {
	if len(provider.Protocols) == 0 {
		// Codex historical entries without explicit protocol tags remain compatible;
		// Claude strictly requires anthropic-compatible.
		return requiredProtocol == APIProviderProtocolOpenAICompatible
	}
	for _, protocol := range provider.Protocols {
		if strings.EqualFold(strings.TrimSpace(protocol), requiredProtocol) {
			return true
		}
	}
	return false
}
