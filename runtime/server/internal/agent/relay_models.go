package agent

import (
	"context"
	"log"
	"net/url"
	"strings"
	"time"

	agenttypes "mindfs/server/internal/agent/types"
)

const (
	RelayProtocolOpenAI    = "openai-compatible"
	RelayProtocolAnthropic = "anthropic-compatible"
	RelayProtocolGemini    = "gemini-compatible"

	relayModelsFetchTimeout = 6 * time.Second
)

// RelayEndpoint describes the third-party relay currently active for an agent.
type RelayEndpoint struct {
	BaseURL  string
	APIKey   string
	Protocol string
}

// SupplementActiveRelayModels discovers whether agentName is currently
// configured to talk to a third-party relay, fetches that relay's model list,
// deduplicates against native models (preserving native metadata such as
// reasoning effort), and appends only missing relay models after native ones.
func SupplementActiveRelayModels(
	ctx context.Context,
	agentName string,
	def Definition,
	native []agenttypes.ModelInfo,
) []agenttypes.ModelInfo {
	endpoint, ok := DiscoverActiveRelayEndpoint(agentName, def)
	if !ok {
		return native
	}
	fetchCtx, cancel := context.WithTimeout(ctx, relayModelsFetchTimeout)
	defer cancel()

	relayModels, err := FetchActiveRelayModels(fetchCtx, endpoint)
	if err != nil {
		log.Printf("[agent/relay-models] fetch.skip agent=%s host=%s protocol=%s err=%v",
			strings.TrimSpace(agentName), safeHostForLog(endpoint.BaseURL), endpoint.Protocol, sanitizeRelayError(err))
		return native
	}
	merged := MergeRelayModels(native, relayModels)
	log.Printf("[agent/relay-models] fetch.done agent=%s host=%s native=%d relay=%d merged=%d",
		strings.TrimSpace(agentName), safeHostForLog(endpoint.BaseURL), len(native), len(relayModels), len(merged))
	return merged
}

// MergeRelayModels keeps all native models (and their official metadata) first
// in their original order, deduplicates relay model IDs against native models
// and against themselves, and appends extra relay models at the end.
func MergeRelayModels(native []agenttypes.ModelInfo, relayModelIDs []string) []agenttypes.ModelInfo {
	if len(relayModelIDs) == 0 {
		return native
	}
	out := append([]agenttypes.ModelInfo(nil), native...)
	seen := make(map[string]bool, len(out)+len(relayModelIDs))
	for _, model := range out {
		if id := strings.TrimSpace(model.ID); id != "" {
			seen[id] = true
		}
	}
	for _, raw := range relayModelIDs {
		id := strings.TrimSpace(raw)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, agenttypes.ModelInfo{ID: id, Name: id})
	}
	return out
}

func safeHostForLog(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Host
}
