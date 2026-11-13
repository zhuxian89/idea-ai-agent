package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

// Sample local control endpoints independently of the user's browser connection.
func sampleServices(ctx context.Context, dir, observerAddress string, log *recorder) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		for _, endpoint := range []struct{ name, file, path string }{
			{"core", "core.json", "/control/status"},
			{"gateway", "host.json", "/control/status"},
			{"connector", "host.json", "/control/relay-status"},
		} {
			if ctx.Err() != nil {
				return
			}
			started := time.Now()
			event := map[string]any{"source": "local_health", "service": endpoint.name}
			err := func() error {
				data, err := os.ReadFile(filepath.Join(dir, endpoint.file))
				if err != nil {
					return err
				}
				var descriptor struct {
					URL       string `json:"url"`
					Token     string `json:"token"`
					RemoteURL string `json:"remote_url"`
				}
				if err := json.Unmarshal(data, &descriptor); err != nil {
					return err
				}
				u, err := url.Parse(descriptor.URL)
				if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
					return fmt.Errorf("expected a loopback control endpoint")
				}
				if endpoint.name == "core" {
					event["observation_routed"] = descriptor.RemoteURL == observerAddress
				}
				u.Path = endpoint.path
				req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
				if err != nil {
					return err
				}
				req.Header.Set("Authorization", "Bearer "+descriptor.Token)
				resp, err := client.Do(req)
				if err != nil {
					return err
				}
				defer resp.Body.Close()
				event["status"] = resp.StatusCode
				if resp.StatusCode != http.StatusOK {
					return nil
				}
				var status map[string]json.RawMessage
				if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
					return err
				}
				for _, key := range []string{"pid", "runtime_version", "connected", "no_relayer"} {
					if value, ok := status[key]; ok {
						event[key] = value
					}
				}
				return nil
			}()
			event["elapsed_ms"] = time.Since(started).Milliseconds()
			if err != nil {
				// Record the failed stage without serializing descriptor/response contents.
				event["error_type"] = fmt.Sprintf("%T", err)
			}
			log.write(event)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
