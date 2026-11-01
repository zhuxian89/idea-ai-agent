// Package remotehost owns the single remote entry point shared by IDEA projects.
package remotehost

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"mindfs/server/internal/relay"
)

const Protocol = 1
const ProjectTokenHeader = "X-Idea-Remote-Host"

type Descriptor struct {
	Protocol int    `json:"protocol"`
	URL      string `json:"url"`
	Token    string `json:"token"`
}
type Status struct {
	relay.Status
	Protocol       int              `json:"protocol"`
	Enabled        bool             `json:"enabled"`
	PairingSecret  string           `json:"pairing_secret,omitempty"`
	RemoteHost     bool             `json:"remote_host"`
	Projects       []ManagedProject `json:"projects,omitempty"`
	RuntimeVersion string           `json:"runtime_version,omitempty"`
}
type Registration struct {
	Protocol      int    `json:"protocol"`
	ProjectPath   string `json:"project_path"`
	Name          string `json:"name"`
	OwnerID       string `json:"owner_id"`
	Address       string `json:"address"`
	Token         string `json:"token"`
	E2EENodeID    string `json:"e2ee_node_id"`
	PairingSecret string `json:"pairing_secret"`
	Enabled       bool   `json:"enabled"`
}
type Ownership struct {
	ProjectID string `json:"project_id"`
	OwnerID   string `json:"owner_id"`
}
type Project struct {
	ProjectID    string `json:"project_id"`
	Name         string `json:"name"`
	Label        string `json:"label"`
	Availability string `json:"availability"`
}
type ManagedProject struct {
	Project
	Enabled bool `json:"enabled"`
}
type APIError struct {
	Status int
	Code   string
}

func (e *APIError) Error() string { return e.Code }

func DefaultDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "LocalAIAgent", "remote"), nil
}
func ReadDescriptor(dir string) (Descriptor, error) {
	var d Descriptor
	b, err := os.ReadFile(filepath.Join(dir, "host.json"))
	if err != nil {
		return d, err
	}
	if err = json.Unmarshal(b, &d); err != nil {
		return d, err
	}
	if d.Protocol != Protocol {
		return d, fmt.Errorf("remote_protocol_incompatible")
	}
	if _, err = loopbackURL(d.URL); err != nil {
		return d, err
	}
	if d.Token == "" {
		return d, fmt.Errorf("remote_host_invalid_descriptor")
	}
	return d, nil
}
func loopbackURL(address string) (*url.URL, error) {
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "http" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.Port() == "" {
		return nil, fmt.Errorf("remote_host_invalid_address")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return nil, fmt.Errorf("remote_host_invalid_address")
	}
	return u, nil
}

// Client reads the descriptor for every request, so a restarted host is discoverable.
type Client struct {
	Dir  string
	HTTP *http.Client
}

func NewClient(dir string) *Client {
	return &Client{Dir: dir, HTTP: &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (c *Client) Call(ctx context.Context, method, path string, input, output any) error {
	d, err := ReadDescriptor(c.Dir)
	if err != nil {
		return err
	}
	var body io.Reader
	if input != nil {
		b, e := json.Marshal(input)
		if e != nil {
			return e
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.URL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+d.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var result struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&result)
		if result.Error == "" {
			result.Error = fmt.Sprintf("remote_host_http_%d", resp.StatusCode)
		}
		return &APIError{resp.StatusCode, result.Error}
	}
	if output == nil {
		_, err = io.Copy(io.Discard, resp.Body)
		return err
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(output)
}
func (c *Client) Status(ctx context.Context) (Status, error) {
	var s Status
	e := c.Call(ctx, "GET", "/control/status", nil, &s)
	return s, e
}
func (c *Client) Bind(ctx context.Context) (Status, error) {
	var s Status
	e := c.Call(ctx, "POST", "/control/bind", struct{}{}, &s)
	return s, e
}
func (c *Client) SetEnabled(ctx context.Context, enabled bool) error {
	return c.Call(ctx, "POST", "/control/enable", map[string]bool{"enabled": enabled}, nil)
}
func (c *Client) SetSharing(ctx context.Context, projectID string, enabled bool) error {
	return c.Call(ctx, "POST", "/control/projects/sharing", map[string]any{"project_id": projectID, "enabled": enabled}, nil)
}
func (c *Client) Register(ctx context.Context, r Registration) (string, error) {
	var out struct {
		ProjectID string `json:"project_id"`
	}
	e := c.Call(ctx, "POST", "/control/register", r, &out)
	return out.ProjectID, e
}
func (c *Client) Heartbeat(ctx context.Context, o Ownership) error {
	return c.Call(ctx, "POST", "/control/heartbeat", o, nil)
}
func (c *Client) Unregister(ctx context.Context, o Ownership) error {
	return c.Call(ctx, "POST", "/control/unregister", o, nil)
}
func (c *Client) SetProjectEnabled(ctx context.Context, o Ownership, enabled bool) error {
	return c.Call(ctx, "POST", "/control/project/enable", struct {
		Ownership
		Enabled bool `json:"enabled"`
	}{o, enabled}, nil)
}
