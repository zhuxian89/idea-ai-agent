package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mindfs/server/internal/agent"
	"mindfs/server/internal/apperr"
	configpkg "mindfs/server/internal/config"
	"mindfs/server/internal/preferences"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	apiProviderProtocolOpenAICompatible    = "openai-compatible"
	apiProviderProtocolAnthropicCompatible = "anthropic-compatible"
	apiProviderProtocolGeminiCompatible    = "gemini-compatible"
)

type agentAPIProvider struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	BaseURL        string   `json:"baseUrl"`
	APIKey         string   `json:"apiKey,omitempty"`
	Protocols      []string `json:"protocols,omitempty"`
	ModelFamilies  []string `json:"modelFamilies"`
	Models         []string `json:"models"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
	activeProtocol string
}

type agentAPIProviderPublic struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	BaseURL       string   `json:"baseUrl"`
	Protocols     []string `json:"protocols,omitempty"`
	ModelFamilies []string `json:"modelFamilies"`
	Models        []string `json:"models,omitempty"`
	CreatedAt     string   `json:"createdAt"`
	UpdatedAt     string   `json:"updatedAt"`
}

type agentAPIProviderCreateRequest struct {
	Name    string `json:"name"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

type agentAPIProviderSyncRequest struct {
	Providers []agentAPIProviderCreateRequest `json:"providers"`
}

type agentAPIProviderSwitchRequest struct {
	Agent      string `json:"agent"`
	ProviderID string `json:"provider_id"`
}

type agentAPIProviderProbeResult struct {
	Protocols     []string
	Models        []string
	ModelFamilies []string
}

func (h *HTTPHandler) handleAgentAPIProvidersList(w http.ResponseWriter, r *http.Request) {
	agentConfigMu.Lock()
	defer agentConfigMu.Unlock()
	agentName := strings.TrimSpace(r.URL.Query().Get("agent"))
	providers, err := readAgentAPIProviders()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err)
		return
	}
	out := make([]agentAPIProviderPublic, 0, len(providers))
	for _, provider := range providers {
		if agentName != "" && !apiProviderCompatibleWithAgent(provider, agentName) {
			continue
		}
		out = append(out, publicAgentAPIProvider(provider))
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *HTTPHandler) handleAgentAPIProviderCreate(w http.ResponseWriter, r *http.Request) {
	var req agentAPIProviderCreateRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxUploadRequestBytes)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid request body"))
		return
	}
	agentConfigMu.Lock()
	defer agentConfigMu.Unlock()
	provider, err := createAgentAPIProvider(r.Context(), req)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errAgentConfigConflict) {
			status = http.StatusConflict
		}
		respondError(w, status, err)
		return
	}
	respondJSON(w, http.StatusOK, publicAgentAPIProvider(provider))
}

func (h *HTTPHandler) handleAgentAPIProvidersSync(w http.ResponseWriter, r *http.Request) {
	var req agentAPIProviderSyncRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxUploadRequestBytes)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid request body"))
		return
	}
	agentConfigMu.Lock()
	defer agentConfigMu.Unlock()
	providers, err := syncAgentAPIProviders(r.Context(), req.Providers)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	out := make([]agentAPIProviderPublic, 0, len(providers))
	for _, provider := range providers {
		out = append(out, publicAgentAPIProvider(provider))
	}
	respondJSON(w, http.StatusOK, map[string]any{"providers": out})
}

func (h *HTTPHandler) handleAgentAPIProviderDelete(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		respondError(w, http.StatusBadRequest, errInvalidRequest("provider id required"))
		return
	}
	agentConfigMu.Lock()
	defer agentConfigMu.Unlock()
	providers, err := deleteAgentAPIProvider(id)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	out := make([]agentAPIProviderPublic, 0, len(providers))
	for _, provider := range providers {
		out = append(out, publicAgentAPIProvider(provider))
	}
	respondJSON(w, http.StatusOK, map[string]any{"deleted": true, "id": id, "providers": out})
}

func (h *HTTPHandler) handleAgentAPIProviderSwitch(w http.ResponseWriter, r *http.Request) {
	var req agentAPIProviderSwitchRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxUploadRequestBytes)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, errInvalidRequest("invalid request body"))
		return
	}
	agentConfigMu.Lock()
	defer agentConfigMu.Unlock()
	provider, err := switchAgentAPIProvider(req, h.AppContext)
	if err != nil {
		respondError(w, http.StatusBadRequest, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"provider": publicAgentAPIProvider(provider),
	})
}

func createAgentAPIProvider(ctx context.Context, req agentAPIProviderCreateRequest) (agentAPIProvider, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return agentAPIProvider{}, errors.New("provider name required")
	}
	if strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
		return agentAPIProvider{}, errors.New("provider name must not contain path separators")
	}
	baseURL, err := normalizeAPIProviderBaseURL(req.BaseURL)
	if err != nil {
		return agentAPIProvider{}, err
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		return agentAPIProvider{}, errors.New("api key required")
	}
	probe, err := probeAgentAPIProvider(ctx, baseURL, apiKey)
	if err != nil {
		return agentAPIProvider{}, err
	}
	providers, err := readAgentAPIProviders()
	if err != nil {
		return agentAPIProvider{}, err
	}
	id := "api-" + slugifyAPIProviderName(name)
	if id == "api-" {
		id = fmt.Sprintf("api-%d", time.Now().UnixNano())
	}
	for _, provider := range providers {
		if provider.ID == id {
			return agentAPIProvider{}, errAgentConfigConflict
		}
	}
	now := time.Now().Format(time.RFC3339)
	provider := agentAPIProvider{
		ID:            id,
		Name:          name,
		BaseURL:       baseURL,
		APIKey:        apiKey,
		Protocols:     probe.Protocols,
		ModelFamilies: probe.ModelFamilies,
		Models:        probe.Models,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	providers = append(providers, provider)
	if err := writeAgentAPIProviders(providers); err != nil {
		return agentAPIProvider{}, err
	}
	return provider, nil
}

func syncAgentAPIProviders(ctx context.Context, requests []agentAPIProviderCreateRequest) ([]agentAPIProvider, error) {
	if len(requests) == 0 {
		return nil, errors.New("providers required")
	}
	providers, err := readAgentAPIProviders()
	if err != nil {
		return nil, err
	}
	byName := make(map[string]int, len(providers))
	for i, provider := range providers {
		byName[strings.TrimSpace(provider.Name)] = i
	}
	now := time.Now().Format(time.RFC3339)
	changed := make([]agentAPIProvider, 0, len(requests))
	seenNames := map[string]struct{}{}
	for _, req := range requests {
		name := strings.TrimSpace(req.Name)
		if name == "" {
			return nil, errors.New("provider name required")
		}
		if strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
			return nil, errors.New("provider name must not contain path separators")
		}
		if _, ok := seenNames[name]; ok {
			continue
		}
		seenNames[name] = struct{}{}
		baseURL, err := normalizeAPIProviderBaseURL(req.BaseURL)
		if err != nil {
			return nil, err
		}
		apiKey := strings.TrimSpace(req.APIKey)
		if apiKey == "" {
			return nil, errors.New("api key required")
		}
		probe, err := probeAgentAPIProvider(ctx, baseURL, apiKey)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		if index, ok := byName[name]; ok {
			provider := providers[index]
			provider.Name = name
			provider.BaseURL = baseURL
			provider.APIKey = apiKey
			provider.Protocols = probe.Protocols
			provider.ModelFamilies = probe.ModelFamilies
			provider.Models = probe.Models
			provider.UpdatedAt = now
			providers[index] = provider
			changed = append(changed, provider)
			continue
		}
		id := "api-" + slugifyAPIProviderName(name)
		if id == "api-" {
			id = fmt.Sprintf("api-%d", time.Now().UnixNano())
		}
		if providerIDExists(providers, id) {
			id = fmt.Sprintf("%s-%d", id, time.Now().UnixNano())
		}
		provider := agentAPIProvider{
			ID:            id,
			Name:          name,
			BaseURL:       baseURL,
			APIKey:        apiKey,
			Protocols:     probe.Protocols,
			ModelFamilies: probe.ModelFamilies,
			Models:        probe.Models,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		providers = append(providers, provider)
		byName[name] = len(providers) - 1
		changed = append(changed, provider)
	}
	if len(changed) == 0 {
		return nil, errors.New("no valid providers")
	}
	if err := writeAgentAPIProviders(providers); err != nil {
		return nil, err
	}
	return changed, nil
}

func providerIDExists(providers []agentAPIProvider, id string) bool {
	for _, provider := range providers {
		if provider.ID == id {
			return true
		}
	}
	return false
}

func deleteAgentAPIProvider(id string) ([]agentAPIProvider, error) {
	providers, err := readAgentAPIProviders()
	if err != nil {
		return nil, err
	}
	next := make([]agentAPIProvider, 0, len(providers))
	found := false
	for _, provider := range providers {
		if provider.ID == id {
			found = true
			continue
		}
		next = append(next, provider)
	}
	if !found {
		return nil, errors.New("provider not found")
	}
	if err := writeAgentAPIProviders(next); err != nil {
		return nil, err
	}
	return next, nil
}

func switchAgentAPIProvider(req agentAPIProviderSwitchRequest, app *AppContext) (agentAPIProvider, error) {
	agentName := strings.TrimSpace(req.Agent)
	if agentName == "" {
		return agentAPIProvider{}, errors.New("agent required")
	}
	cfg, err := agent.LoadConfig("")
	if err != nil {
		return agentAPIProvider{}, err
	}
	if _, ok := cfg.GetAgent(agentName); !ok {
		return agentAPIProvider{}, fmt.Errorf("agent not configured: %s", agentName)
	}
	providerID := strings.TrimSpace(req.ProviderID)
	if providerID == "" {
		return agentAPIProvider{}, errors.New("provider id required")
	}
	providers, err := readAgentAPIProviders()
	if err != nil {
		return agentAPIProvider{}, err
	}
	var provider agentAPIProvider
	for _, item := range providers {
		if item.ID == providerID {
			provider = item
			break
		}
	}
	if provider.ID == "" {
		return agentAPIProvider{}, errors.New("provider not found")
	}
	selectedProtocol, ok := selectAPIProviderProtocolForAgent(provider, agentName)
	if !ok {
		return agentAPIProvider{}, fmt.Errorf("provider protocols %s are not compatible with agent %s", strings.Join(agentAPIProviderProtocols(provider), ", "), agentName)
	}
	provider.activeProtocol = selectedProtocol
	if err := applyAgentAPIProvider(agentName, provider, app); err != nil {
		return agentAPIProvider{}, err
	}
	if app != nil && app.GetPreferences() != nil {
		if err := app.GetPreferences().UpdateAgentLastConfigSelection(agentName, preferences.LastConfigSelection{
			Type: "api_provider",
			ID:   provider.ID,
			Name: provider.Name,
		}); err != nil {
			return agentAPIProvider{}, err
		}
	}
	if app != nil && app.GetAgentPool() != nil {
		app.GetAgentPool().KillAgentProcess(agentName, 0)
	}
	triggerAgentConfigSwitchProbe(app, agentName)
	return provider, nil
}

func readAgentAPIProviders() ([]agentAPIProvider, error) {
	path, err := agentAPIProvidersPath()
	if err != nil {
		return nil, err
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []agentAPIProvider{}, nil
		}
		return nil, apperr.Wrap("read", path, err)
	}
	if len(strings.TrimSpace(string(payload))) == 0 {
		return []agentAPIProvider{}, nil
	}
	var providers []agentAPIProvider
	if err := json.Unmarshal(payload, &providers); err != nil {
		return nil, err
	}
	for i := range providers {
		providers[i].Protocols = agentAPIProviderProtocols(providers[i])
	}
	return providers, nil
}

func writeAgentAPIProviders(providers []agentAPIProvider) error {
	path, err := agentAPIProvidersPath()
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

func agentAPIProvidersPath() (string, error) {
	configDir, err := configpkg.MindFSConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "api-providers.json"), nil
}

func publicAgentAPIProvider(provider agentAPIProvider) agentAPIProviderPublic {
	return agentAPIProviderPublic{
		ID:            provider.ID,
		Name:          provider.Name,
		BaseURL:       provider.BaseURL,
		Protocols:     agentAPIProviderProtocols(provider),
		ModelFamilies: append([]string(nil), provider.ModelFamilies...),
		Models:        append([]string(nil), provider.Models...),
		CreatedAt:     provider.CreatedAt,
		UpdatedAt:     provider.UpdatedAt,
	}
}

func normalizeAPIProviderBaseURL(input string) (string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(input), "/")
	if baseURL == "" {
		return "", errors.New("baseUrl required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("baseUrl must be an absolute URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("baseUrl scheme must be http or https")
	}
	return baseURL, nil
}

func openAIModelsURL(baseURL string) string {
	base := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(base, "/v1") {
		return base + "/models"
	}
	return base + "/v1/models"
}

func openAIModelsBaseURL(baseURL string) string {
	base := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(base, "/v1") {
		return base
	}
	return base + "/v1"
}

func geminiModelsURL(baseURL string) string {
	base := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(base, "/v1beta") {
		return base + "/models"
	}
	return base + "/v1beta/models"
}

func apiProviderCompatibleWithAgent(provider agentAPIProvider, agentName string) bool {
	_, ok := selectAPIProviderProtocolForAgent(provider, agentName)
	return ok
}

func selectAPIProviderProtocolForAgent(provider agentAPIProvider, agentName string) (string, bool) {
	providerProtocols := agentAPIProviderProtocols(provider)
	for _, supported := range agentSupportedAPIProtocols(agentName) {
		for _, protocol := range providerProtocols {
			if protocol == supported {
				return protocol, true
			}
		}
	}
	return "", false
}

func agentAPIProviderProtocols(provider agentAPIProvider) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(provider.Protocols))
	for _, protocol := range provider.Protocols {
		protocol = strings.TrimSpace(protocol)
		if protocol == "" || seen[protocol] {
			continue
		}
		seen[protocol] = true
		out = append(out, protocol)
	}
	return out
}

func agentAPIProviderActiveProtocol(provider agentAPIProvider) string {
	if protocol := strings.TrimSpace(provider.activeProtocol); protocol != "" {
		return protocol
	}
	protocols := agentAPIProviderProtocols(provider)
	if len(protocols) == 0 {
		return ""
	}
	return protocols[0]
}

func applyAgentAPIProviderCapabilities(statuses []agent.Status) []agent.Status {
	out := make([]agent.Status, len(statuses))
	for i, status := range statuses {
		protocols := agentSupportedAPIProtocols(status.Name)
		status.SupportedAPIProviderProtocols = append([]string(nil), protocols...)
		status.SupportsAPIProviderSwitch = len(protocols) > 0
		out[i] = status
	}
	return out
}

func agentSupportedAPIProtocols(agentName string) []string {
	switch normalizedAPIProviderAgent(agentName) {
	case "codex":
		return []string{apiProviderProtocolOpenAICompatible}
	case "claude":
		return []string{apiProviderProtocolAnthropicCompatible}
	case "gemini":
		return []string{apiProviderProtocolGeminiCompatible}
	case "copilot", "qwen", "kimi", "opencode", "openclaw", "omp":
		return []string{apiProviderProtocolOpenAICompatible, apiProviderProtocolAnthropicCompatible}
	case "pi":
		return []string{apiProviderProtocolOpenAICompatible, apiProviderProtocolAnthropicCompatible, apiProviderProtocolGeminiCompatible}
	case "hermes":
		return []string{apiProviderProtocolOpenAICompatible}
	default:
		return nil
	}
}

func successfulProbeProtocols(modelsByProtocol map[string][]string) []string {
	priority := []string{
		apiProviderProtocolOpenAICompatible,
		apiProviderProtocolAnthropicCompatible,
		apiProviderProtocolGeminiCompatible,
	}
	out := make([]string, 0, len(priority))
	for _, protocol := range priority {
		if len(modelsByProtocol[protocol]) > 0 {
			out = append(out, protocol)
		}
	}
	return out
}

func mergeProtocolModels(modelsByProtocol map[string][]string, protocols []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, protocol := range protocols {
		for _, model := range modelsByProtocol[protocol] {
			model = strings.TrimSpace(model)
			if model == "" || seen[model] {
				continue
			}
			seen[model] = true
			out = append(out, model)
		}
	}
	return out
}

func agentAPIProviderConfigName(provider agentAPIProvider) string {
	name := strings.TrimSpace(provider.Name)
	if name == "" {
		name = strings.TrimSpace(provider.ID)
	}
	if name == "" {
		return "api-provider"
	}
	return name
}

func normalizedAPIProviderAgent(agentName string) string {
	name := strings.ToLower(strings.TrimSpace(agentName))
	switch name {
	case "claude", "claudecode", "claude-code":
		return "claude"
	case "github-copilot", "copilot-cli":
		return "copilot"
	case "pi", "pi-acp", "pi-coding-agent":
		return "pi"
	case "qwen-code", "qwencode":
		return "qwen"
	case "kimi-code":
		return "kimi"
	default:
		return name
	}
}

func slugifyAPIProviderName(name string) string {
	var b strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case r == '.' || r == '_' || r == '-' || r == ' ':
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

func normalizeModelIDs(input []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(input))
	for _, item := range input {
		id := strings.TrimSpace(item)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func inferModelFamilies(models []string) []string {
	seen := map[string]bool{}
	var families []string
	add := func(name string) {
		if !seen[name] {
			seen[name] = true
			families = append(families, name)
		}
	}
	for _, model := range models {
		lower := strings.ToLower(model)
		switch {
		case strings.Contains(lower, "deepseek"):
			add("deepseek")
		case strings.Contains(lower, "claude"):
			add("anthropic")
		case strings.Contains(lower, "gemini"):
			add("gemini")
		case strings.Contains(lower, "qwen"):
			add("qwen")
		case strings.Contains(lower, "glm") || strings.Contains(lower, "zhipu") || strings.Contains(lower, "bigmodel"):
			add("glm")
		case strings.Contains(lower, "kimi") || strings.Contains(lower, "moonshot"):
			add("kimi")
		case strings.Contains(lower, "doubao") || strings.Contains(lower, "seed"):
			add("doubao")
		case strings.HasPrefix(lower, "gpt-") || strings.HasPrefix(lower, "o1") || strings.HasPrefix(lower, "o3") || strings.HasPrefix(lower, "o4"):
			add("openai")
		}
	}
	if len(families) == 0 {
		families = append(families, "unknown")
	}
	sort.Strings(families)
	return families
}

func firstModelOrDefault(models []string, fallback string) string {
	for _, model := range models {
		if trimmed := strings.TrimSpace(model); trimmed != "" {
			return trimmed
		}
	}
	return fallback
}

func qwenModelEntries(provider agentAPIProvider, envKey, baseURL string) []map[string]any {
	out := make([]map[string]any, 0, len(provider.Models))
	for _, model := range provider.Models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		out = append(out, map[string]any{
			"id":      model,
			"name":    model,
			"envKey":  envKey,
			"baseUrl": baseURL,
		})
	}
	return out
}

func modelObject(models []string) map[string]any {
	out := map[string]any{}
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		out[model] = map[string]any{"name": model}
	}
	return out
}

func modelArray(models []string) []map[string]any {
	out := make([]map[string]any, 0, len(models))
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		out = append(out, map[string]any{"id": model, "name": model})
	}
	return out
}

func additiveAgentAPI(protocol string) string {
	if protocol == apiProviderProtocolAnthropicCompatible {
		return "anthropic-messages"
	}
	return "openai-completions"
}

func piAgentAPI(protocol string) string {
	switch protocol {
	case apiProviderProtocolAnthropicCompatible:
		return "anthropic-messages"
	case apiProviderProtocolGeminiCompatible:
		return "google-generative-ai"
	default:
		return "openai-completions"
	}
}

func piAgentBaseURL(provider agentAPIProvider) string {
	switch agentAPIProviderActiveProtocol(provider) {
	case apiProviderProtocolAnthropicCompatible:
		return anthropicBaseURL(provider.BaseURL)
	case apiProviderProtocolGeminiCompatible:
		return geminiModelsBaseURL(provider.BaseURL)
	default:
		return openAIModelsBaseURL(provider.BaseURL)
	}
}

func anthropicBaseURL(baseURL string) string {
	base := strings.TrimRight(baseURL, "/")
	return strings.TrimSuffix(base, "/v1")
}

func geminiModelsBaseURL(baseURL string) string {
	base := strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(base, "/v1beta") {
		return base
	}
	return base + "/v1beta"
}
