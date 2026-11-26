package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"mindfs/server/internal/agent"
)

func probeAgentAPIProvider(ctx context.Context, baseURL, apiKey string) (agentAPIProviderProbeResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	attempts := []struct {
		protocol string
		fn       func(context.Context, string, string) ([]string, error)
	}{
		{apiProviderProtocolOpenAICompatible, agent.FetchOpenAICompatibleModels},
		{apiProviderProtocolAnthropicCompatible, agent.FetchAnthropicCompatibleModels},
		{apiProviderProtocolGeminiCompatible, agent.FetchGeminiCompatibleModels},
	}
	type probeAttemptResult struct {
		protocol string
		models   []string
		err      error
	}
	results := make(chan probeAttemptResult, len(attempts))
	for _, attempt := range attempts {
		attempt := attempt
		go func() {
			models, err := attempt.fn(ctx, baseURL, apiKey)
			if err == nil {
				models = normalizeModelIDs(models)
			}
			results <- probeAttemptResult{protocol: attempt.protocol, models: models, err: err}
		}()
	}
	var failures []string
	modelsByProtocol := map[string][]string{}
	for range attempts {
		result := <-results
		if result.err != nil {
			failures = append(failures, result.protocol+": "+result.err.Error())
			continue
		}
		if len(result.models) == 0 {
			failures = append(failures, result.protocol+": no models returned")
			continue
		}
		modelsByProtocol[result.protocol] = result.models
	}
	protocols := successfulProbeProtocols(modelsByProtocol)
	if len(protocols) > 0 {
		models := mergeProtocolModels(modelsByProtocol, protocols)
		families := inferModelFamilies(models)
		return agentAPIProviderProbeResult{
			Protocols:     protocols,
			Models:        models,
			ModelFamilies: families,
		}, nil
	}
	return agentAPIProviderProbeResult{}, fmt.Errorf("unable to identify API protocol: %s", strings.Join(failures, "; "))
}
