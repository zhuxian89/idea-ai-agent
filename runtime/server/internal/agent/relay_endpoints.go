package agent

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	toml "github.com/pelletier/go-toml/v2"
	"gopkg.in/yaml.v3"
)

// DiscoverActiveRelayEndpoint inspects the active configuration for agentName
// (agent definition env, native CLI config files, and process env) and returns
// a RelayEndpoint when the agent currently targets a custom third-party relay.
func DiscoverActiveRelayEndpoint(agentName string, def Definition) (RelayEndpoint, bool) {
	var ep RelayEndpoint
	switch normalizeRelayAgentName(agentName) {
	case "codex":
		ep = discoverCodexRelayEndpoint(def.Env)
	case "claude":
		ep = discoverClaudeRelayEndpoint(def.Env)
	case "gemini":
		ep = discoverGeminiRelayEndpoint(def.Env)
	case "copilot":
		ep = discoverCopilotRelayEndpoint(def.Env)
	case "qwen":
		ep = discoverQwenRelayEndpoint(def.Env)
	case "kimi":
		ep = discoverKimiRelayEndpoint(def.Env)
	case "opencode":
		ep = discoverOpenCodeRelayEndpoint(def.Env)
	case "openclaw":
		ep = discoverOpenClawRelayEndpoint(def.Env)
	case "omp":
		ep = discoverOMPRelayEndpoint(def.Env)
	case "pi":
		ep = discoverPiRelayEndpoint(def.Env)
	case "hermes":
		ep = discoverHermesRelayEndpoint(def.Env)
	default:
		ep = discoverGenericEnvRelayEndpoint(def.Env)
	}
	ep.BaseURL = strings.TrimRight(strings.TrimSpace(ep.BaseURL), "/")
	ep.APIKey = strings.TrimSpace(ep.APIKey)
	if ep.Protocol == "" {
		ep.Protocol = RelayProtocolOpenAI
	}
	if !isCustomRelayBaseURL(ep.BaseURL) {
		return RelayEndpoint{}, false
	}
	return ep, true
}

func normalizeRelayAgentName(agentName string) string {
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

func isCustomRelayBaseURL(raw string) bool {
	if raw == "" {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	switch host {
	case "",
		"api.openai.com",
		"chatgpt.com",
		"api.anthropic.com",
		"generativelanguage.googleapis.com",
		"api.github.com",
		"api.githubcopilot.com":
		return false
	default:
		return true
	}
}

func resolveAgentHomeDir(agentEnv map[string]string) string {
	if home := lookupMapEnv(agentEnv, "HOME", "USERPROFILE"); home != "" {
		return home
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(home)
}

func lookupAgentEnv(agentEnv map[string]string, keys ...string) string {
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if agentEnv != nil {
			if value := strings.TrimSpace(agentEnv[key]); value != "" {
				return value
			}
		}
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func lookupMapEnv(m map[string]string, keys ...string) string {
	if m == nil {
		return ""
	}
	for _, key := range keys {
		if value := strings.TrimSpace(m[key]); value != "" {
			return value
		}
	}
	return ""
}

func discoverCodexRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	codexHome := lookupAgentEnv(agentEnv, "CODEX_HOME")
	if codexHome == "" {
		if home := resolveAgentHomeDir(agentEnv); home != "" {
			codexHome = filepath.Join(home, ".codex")
		}
	}
	var baseURL, apiKey string
	if codexHome != "" {
		if payload, err := os.ReadFile(filepath.Join(codexHome, "config.toml")); err == nil {
			var cfg struct {
				ModelProvider  string `toml:"model_provider"`
				ModelProviders map[string]struct {
					BaseURL                 string `toml:"base_url"`
					EnvKey                  string `toml:"env_key"`
					ExperimentalBearerToken string `toml:"experimental_bearer_token"`
					RequiresOpenAIAuth      bool   `toml:"requires_openai_auth"`
				} `toml:"model_providers"`
			}
			if err := toml.Unmarshal(payload, &cfg); err == nil {
				providerName := strings.TrimSpace(cfg.ModelProvider)
				if mp, ok := cfg.ModelProviders[providerName]; providerName != "" && ok {
					baseURL = strings.TrimSpace(mp.BaseURL)
					apiKey = strings.TrimSpace(mp.ExperimentalBearerToken)
					if apiKey == "" && strings.TrimSpace(mp.EnvKey) != "" {
						apiKey = lookupAgentEnv(agentEnv, mp.EnvKey)
					}
					if apiKey == "" {
						apiKey = lookupAgentEnv(agentEnv, "OPENAI_API_KEY")
					}
					if apiKey == "" {
						apiKey = readCodexAuthKey(filepath.Join(codexHome, "auth.json"), mp.RequiresOpenAIAuth)
					}
				}
			}
		}
	}
	if baseURL == "" {
		baseURL = lookupAgentEnv(agentEnv, "OPENAI_BASE_URL")
		if apiKey == "" {
			apiKey = lookupAgentEnv(agentEnv, "OPENAI_API_KEY")
		}
		if apiKey == "" && codexHome != "" {
			apiKey = readCodexAuthKey(filepath.Join(codexHome, "auth.json"), false)
		}
	}
	return RelayEndpoint{BaseURL: baseURL, APIKey: apiKey, Protocol: RelayProtocolOpenAI}
}

func readCodexAuthKey(path string, allowAccessToken bool) string {
	payload, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var auth struct {
		OpenAIAPIKey string `json:"OPENAI_API_KEY"`
		Tokens       *struct {
			AccessToken string `json:"access_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(payload, &auth); err != nil {
		return ""
	}
	if key := strings.TrimSpace(auth.OpenAIAPIKey); key != "" {
		return key
	}
	if allowAccessToken && auth.Tokens != nil {
		return strings.TrimSpace(auth.Tokens.AccessToken)
	}
	return ""
}

func discoverClaudeRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	baseURL := lookupMapEnv(agentEnv, "ANTHROPIC_BASE_URL")
	apiKey := lookupMapEnv(agentEnv, "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")

	configDir := lookupAgentEnv(agentEnv, "CLAUDE_CONFIG_DIR")
	if configDir == "" {
		if home := resolveAgentHomeDir(agentEnv); home != "" {
			configDir = filepath.Join(home, ".claude")
		}
	}
	if configDir != "" && (baseURL == "" || apiKey == "") {
		if payload, err := os.ReadFile(filepath.Join(configDir, "settings.json")); err == nil {
			var settings struct {
				Env map[string]string `json:"env"`
			}
			if err := json.Unmarshal(payload, &settings); err == nil && settings.Env != nil {
				if baseURL == "" {
					baseURL = lookupMapEnv(settings.Env, "ANTHROPIC_BASE_URL")
				}
				if apiKey == "" {
					apiKey = lookupMapEnv(settings.Env, "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")
				}
			}
		}
	}
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv("ANTHROPIC_BASE_URL"))
	}
	if apiKey == "" {
		apiKey = lookupAgentEnv(nil, "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")
	}
	return RelayEndpoint{BaseURL: baseURL, APIKey: apiKey, Protocol: RelayProtocolAnthropic}
}

func discoverGeminiRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	baseURL := lookupMapEnv(agentEnv, "GOOGLE_GEMINI_BASE_URL")
	apiKey := lookupMapEnv(agentEnv, "GEMINI_API_KEY")
	if baseURL == "" || apiKey == "" {
		if home := resolveAgentHomeDir(agentEnv); home != "" {
			if payload, err := os.ReadFile(filepath.Join(home, ".gemini", ".env")); err == nil {
				fileEnv := parseRelayDotEnv(string(payload))
				if baseURL == "" {
					baseURL = lookupMapEnv(fileEnv, "GOOGLE_GEMINI_BASE_URL")
				}
				if apiKey == "" {
					apiKey = lookupMapEnv(fileEnv, "GEMINI_API_KEY")
				}
			}
		}
	}
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv("GOOGLE_GEMINI_BASE_URL"))
	}
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	}
	return RelayEndpoint{BaseURL: baseURL, APIKey: apiKey, Protocol: RelayProtocolGemini}
}

func discoverCopilotRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	baseURL := lookupAgentEnv(agentEnv, "COPILOT_PROVIDER_BASE_URL")
	apiKey := lookupAgentEnv(agentEnv, "COPILOT_PROVIDER_API_KEY")
	protocol := RelayProtocolOpenAI
	if strings.EqualFold(lookupAgentEnv(agentEnv, "COPILOT_PROVIDER_TYPE"), "anthropic") {
		protocol = RelayProtocolAnthropic
	}
	return RelayEndpoint{BaseURL: baseURL, APIKey: apiKey, Protocol: protocol}
}

func discoverQwenRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	if home := resolveAgentHomeDir(agentEnv); home != "" {
		if payload, err := os.ReadFile(filepath.Join(home, ".qwen", "settings.json")); err == nil {
			var settings struct {
				Env            map[string]string `json:"env"`
				ModelProviders map[string]struct {
					Protocol string `json:"protocol"`
					Models   []struct {
						BaseURL string `json:"baseUrl"`
						EnvKey  string `json:"envKey"`
					} `json:"models"`
				} `json:"modelProviders"`
			}
			if err := json.Unmarshal(payload, &settings); err == nil {
				for _, key := range []string{"openai", "anthropic"} {
					mp, ok := settings.ModelProviders[key]
					if !ok || len(mp.Models) == 0 {
						continue
					}
					baseURL := strings.TrimSpace(mp.Models[0].BaseURL)
					if !isCustomRelayBaseURL(baseURL) {
						continue
					}
					apiKey := lookupMapEnv(settings.Env, mp.Models[0].EnvKey, "OPENAI_API_KEY", "ANTHROPIC_API_KEY")
					if apiKey == "" {
						apiKey = lookupAgentEnv(agentEnv, mp.Models[0].EnvKey, "OPENAI_API_KEY", "ANTHROPIC_API_KEY")
					}
					protocol := RelayProtocolOpenAI
					if strings.EqualFold(strings.TrimSpace(mp.Protocol), "anthropic") || key == "anthropic" {
						protocol = RelayProtocolAnthropic
					}
					return RelayEndpoint{BaseURL: baseURL, APIKey: apiKey, Protocol: protocol}
				}
			}
		}
	}
	return discoverGenericEnvRelayEndpoint(agentEnv)
}

func discoverKimiRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	home := resolveAgentHomeDir(agentEnv)
	if home == "" {
		return RelayEndpoint{}
	}
	payload, err := os.ReadFile(filepath.Join(home, ".kimi", "config.toml"))
	if err != nil {
		return RelayEndpoint{}
	}
	var cfg struct {
		DefaultModel string `toml:"default_model"`
		Providers    map[string]struct {
			Type    string `toml:"type"`
			BaseURL string `toml:"base_url"`
			APIKey  string `toml:"api_key"`
		} `toml:"providers"`
		Models map[string]struct {
			Provider string `toml:"provider"`
		} `toml:"models"`
	}
	if err := toml.Unmarshal(payload, &cfg); err != nil {
		return RelayEndpoint{}
	}
	providerKey := strings.TrimSpace(cfg.DefaultModel)
	if modelEntry, ok := cfg.Models[providerKey]; ok && strings.TrimSpace(modelEntry.Provider) != "" {
		providerKey = strings.TrimSpace(modelEntry.Provider)
	}
	if p, ok := cfg.Providers[providerKey]; ok {
		protocol := RelayProtocolOpenAI
		if strings.EqualFold(strings.TrimSpace(p.Type), "anthropic") {
			protocol = RelayProtocolAnthropic
		}
		return RelayEndpoint{BaseURL: p.BaseURL, APIKey: p.APIKey, Protocol: protocol}
	}
	return RelayEndpoint{}
}

func discoverOpenCodeRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	home := resolveAgentHomeDir(agentEnv)
	if home == "" {
		return RelayEndpoint{}
	}
	payload, err := os.ReadFile(filepath.Join(home, ".config", "opencode", "opencode.json"))
	if err != nil {
		return RelayEndpoint{}
	}
	var cfg struct {
		Model    string `json:"model"`
		Provider map[string]struct {
			NPM     string `json:"npm"`
			Options struct {
				BaseURL string `json:"baseURL"`
				APIKey  string `json:"apiKey"`
			} `json:"options"`
		} `json:"provider"`
	}
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return RelayEndpoint{}
	}
	providerKey, _, _ := strings.Cut(strings.TrimSpace(cfg.Model), "/")
	if p, ok := cfg.Provider[providerKey]; ok {
		protocol := RelayProtocolOpenAI
		if strings.Contains(strings.ToLower(p.NPM), "anthropic") {
			protocol = RelayProtocolAnthropic
		}
		return RelayEndpoint{BaseURL: p.Options.BaseURL, APIKey: p.Options.APIKey, Protocol: protocol}
	}
	return RelayEndpoint{}
}

func discoverOpenClawRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	home := resolveAgentHomeDir(agentEnv)
	if home == "" {
		return RelayEndpoint{}
	}
	payload, err := os.ReadFile(filepath.Join(home, ".openclaw", "openclaw.json"))
	if err != nil {
		return RelayEndpoint{}
	}
	var cfg struct {
		Agents struct {
			Defaults struct {
				Model struct {
					Primary string `json:"primary"`
				} `json:"model"`
			} `json:"defaults"`
		} `json:"agents"`
		Models struct {
			Providers map[string]struct {
				BaseURL string `json:"baseUrl"`
				APIKey  string `json:"apiKey"`
				API     string `json:"api"`
			} `json:"providers"`
		} `json:"models"`
	}
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return RelayEndpoint{}
	}
	providerKey, _, _ := strings.Cut(strings.TrimSpace(cfg.Agents.Defaults.Model.Primary), "/")
	if p, ok := cfg.Models.Providers[providerKey]; ok {
		return RelayEndpoint{BaseURL: p.BaseURL, APIKey: p.APIKey, Protocol: relayProtocolFromAPIMode(p.API)}
	}
	return RelayEndpoint{}
}

func discoverOMPRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	home := resolveAgentHomeDir(agentEnv)
	if home == "" {
		return RelayEndpoint{}
	}
	payload, err := os.ReadFile(filepath.Join(home, ".omp", "agent", "models.yml"))
	if err != nil {
		return RelayEndpoint{}
	}
	var cfg struct {
		ModelRoles map[string]string `yaml:"modelRoles"`
		Providers  map[string]struct {
			BaseURL string `yaml:"baseUrl"`
			APIKey  string `yaml:"apiKey"`
			API     string `yaml:"api"`
		} `yaml:"providers"`
	}
	if err := yaml.Unmarshal(payload, &cfg); err != nil {
		return RelayEndpoint{}
	}
	providerKey, _, _ := strings.Cut(strings.TrimSpace(cfg.ModelRoles["main"]), "/")
	if p, ok := cfg.Providers[providerKey]; ok {
		return RelayEndpoint{BaseURL: p.BaseURL, APIKey: p.APIKey, Protocol: relayProtocolFromAPIMode(p.API)}
	}
	return RelayEndpoint{}
}

func discoverPiRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	home := resolveAgentHomeDir(agentEnv)
	if home == "" {
		return RelayEndpoint{}
	}
	settingsPayload, err := os.ReadFile(filepath.Join(home, ".pi", "agent", "settings.json"))
	if err != nil {
		return RelayEndpoint{}
	}
	var settings struct {
		DefaultProvider string `json:"defaultProvider"`
	}
	if err := json.Unmarshal(settingsPayload, &settings); err != nil || strings.TrimSpace(settings.DefaultProvider) == "" {
		return RelayEndpoint{}
	}
	modelsPayload, err := os.ReadFile(filepath.Join(home, ".pi", "agent", "models.json"))
	if err != nil {
		return RelayEndpoint{}
	}
	var modelsCfg struct {
		Providers map[string]struct {
			BaseURL string `json:"baseUrl"`
			APIKey  string `json:"apiKey"`
			API     string `json:"api"`
		} `json:"providers"`
	}
	if err := json.Unmarshal(modelsPayload, &modelsCfg); err != nil {
		return RelayEndpoint{}
	}
	if p, ok := modelsCfg.Providers[strings.TrimSpace(settings.DefaultProvider)]; ok {
		return RelayEndpoint{BaseURL: p.BaseURL, APIKey: p.APIKey, Protocol: relayProtocolFromAPIMode(p.API)}
	}
	return RelayEndpoint{}
}

func discoverHermesRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	home := resolveAgentHomeDir(agentEnv)
	if home == "" {
		return RelayEndpoint{}
	}
	payload, err := os.ReadFile(filepath.Join(home, ".hermes", "config.yaml"))
	if err != nil {
		return RelayEndpoint{}
	}
	var cfg struct {
		Model struct {
			BaseURL string `yaml:"base_url"`
			APIKey  string `yaml:"api_key"`
		} `yaml:"model"`
	}
	if err := yaml.Unmarshal(payload, &cfg); err != nil {
		return RelayEndpoint{}
	}
	return RelayEndpoint{BaseURL: cfg.Model.BaseURL, APIKey: cfg.Model.APIKey, Protocol: RelayProtocolOpenAI}
}

func discoverGenericEnvRelayEndpoint(agentEnv map[string]string) RelayEndpoint {
	if baseURL := lookupMapEnv(agentEnv, "ANTHROPIC_BASE_URL"); baseURL != "" {
		return RelayEndpoint{
			BaseURL:  baseURL,
			APIKey:   lookupAgentEnv(agentEnv, "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"),
			Protocol: RelayProtocolAnthropic,
		}
	}
	if baseURL := lookupMapEnv(agentEnv, "GOOGLE_GEMINI_BASE_URL"); baseURL != "" {
		return RelayEndpoint{
			BaseURL:  baseURL,
			APIKey:   lookupAgentEnv(agentEnv, "GEMINI_API_KEY"),
			Protocol: RelayProtocolGemini,
		}
	}
	if baseURL := lookupMapEnv(agentEnv, "OPENAI_BASE_URL"); baseURL != "" {
		return RelayEndpoint{
			BaseURL:  baseURL,
			APIKey:   lookupAgentEnv(agentEnv, "OPENAI_API_KEY"),
			Protocol: RelayProtocolOpenAI,
		}
	}
	return RelayEndpoint{}
}

func relayProtocolFromAPIMode(apiMode string) string {
	lower := strings.ToLower(strings.TrimSpace(apiMode))
	switch {
	case strings.Contains(lower, "anthropic"):
		return RelayProtocolAnthropic
	case strings.Contains(lower, "google") || strings.Contains(lower, "gemini"):
		return RelayProtocolGemini
	default:
		return RelayProtocolOpenAI
	}
}

func parseRelayDotEnv(content string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, value, ok := strings.Cut(trimmed, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" {
			out[key] = value
		}
	}
	return out
}
