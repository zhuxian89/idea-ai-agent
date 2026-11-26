package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var relayModelsHTTPClient = &http.Client{Timeout: 12 * time.Second}

// FetchActiveRelayModels queries the relay's models listing endpoint using the
// detected protocol and auth credentials.
func FetchActiveRelayModels(ctx context.Context, ep RelayEndpoint) ([]string, error) {
	switch ep.Protocol {
	case RelayProtocolAnthropic:
		models, err := FetchAnthropicCompatibleModels(ctx, ep.BaseURL, ep.APIKey)
		if err == nil && len(models) > 0 {
			return models, nil
		}
		// Many Anthropic-compatible gateways accept Bearer auth on /v1/models.
		if bearerModels, bearerErr := FetchOpenAICompatibleModels(ctx, ep.BaseURL, ep.APIKey); bearerErr == nil && len(bearerModels) > 0 {
			return bearerModels, nil
		}
		return nil, err
	case RelayProtocolGemini:
		models, err := FetchGeminiCompatibleModels(ctx, ep.BaseURL, ep.APIKey)
		if err == nil && len(models) > 0 {
			return models, nil
		}
		if oaiModels, oaiErr := FetchOpenAICompatibleModels(ctx, ep.BaseURL, ep.APIKey); oaiErr == nil && len(oaiModels) > 0 {
			return oaiModels, nil
		}
		return nil, err
	default:
		return FetchOpenAICompatibleModels(ctx, ep.BaseURL, ep.APIKey)
	}
}

// FetchOpenAICompatibleModels queries an OpenAI-compatible GET /v1/models endpoint.
func FetchOpenAICompatibleModels(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, relayOpenAIModelsURL(baseURL), nil)
	if err != nil {
		return nil, err
	}
	if key := strings.TrimSpace(apiKey); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	return fetchIDListModels(req)
}

// FetchAnthropicCompatibleModels queries an Anthropic-compatible GET /v1/models endpoint.
func FetchAnthropicCompatibleModels(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, relayOpenAIModelsURL(baseURL), nil)
	if err != nil {
		return nil, err
	}
	if key := strings.TrimSpace(apiKey); key != "" {
		req.Header.Set("x-api-key", key)
	}
	req.Header.Set("anthropic-version", "2023-06-01")
	return fetchIDListModels(req)
}

// FetchGeminiCompatibleModels queries a Gemini-compatible GET /v1beta/models endpoint.
// The API key is sent via the x-goog-api-key header rather than a URL query parameter
// so credentials never appear in request URLs or transport error logs.
func FetchGeminiCompatibleModels(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, relayGeminiModelsURL(baseURL), nil)
	if err != nil {
		return nil, err
	}
	if key := strings.TrimSpace(apiKey); key != "" {
		req.Header.Set("x-goog-api-key", key)
	}
	var payload struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := doRelayModelRequest(req, &payload); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(payload.Models))
	for _, item := range payload.Models {
		name := strings.TrimPrefix(strings.TrimSpace(item.Name), "models/")
		if name != "" {
			out = append(out, name)
		}
	}
	return out, nil
}

func fetchIDListModels(req *http.Request) ([]string, error) {
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := doRelayModelRequest(req, &payload); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if id := strings.TrimSpace(item.ID); id != "" {
			out = append(out, id)
		}
	}
	return out, nil
}

func relayOpenAIModelsURL(baseURL string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(base, "/v1") {
		return base + "/models"
	}
	return base + "/v1/models"
}

func relayGeminiModelsURL(baseURL string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(base, "/v1beta") {
		return base + "/models"
	}
	return base + "/v1beta/models"
}

func doRelayModelRequest(req *http.Request, target any) error {
	resp, err := relayModelsHTTPClient.Do(req)
	if err != nil {
		return sanitizeRelayError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return fmt.Errorf("status %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(target)
}

func sanitizeRelayError(err error) error {
	if err == nil {
		return nil
	}
	var urlErr *url.Error
	if !errors.As(err, &urlErr) || urlErr.URL == "" {
		return err
	}
	parsed, parseErr := url.Parse(urlErr.URL)
	if parseErr != nil || (parsed.RawQuery == "" && parsed.User == nil) {
		return err
	}
	parsed.RawQuery = ""
	parsed.User = nil
	sanitized := *urlErr
	sanitized.URL = parsed.String()
	return &sanitized
}
