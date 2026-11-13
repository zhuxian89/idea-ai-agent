package app

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"mindfs/server/internal/agent"
	"mindfs/server/internal/backend"
	"mindfs/server/internal/relay"
)

func validGatewayToken(candidate, token string) bool {
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(token)) == 1
}

// The gateway owns Relay and remote controls only. Project data, local browser
// sessions and Agent processes stay in the separately locked local core.
func StartRemoteGateway(ctx context.Context, dir, addr, version, token string, disabled bool) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host != "127.0.0.1" || len(token) < 32 {
		return fmt.Errorf("remote gateway requires loopback binding and a private token")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer listener.Close()
	remoteListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer remoteListener.Close()
	config, err := agent.LoadConfigWithExtra("")
	if err != nil {
		return err
	}
	manager, err := relay.NewManager(remoteListener.Addr().String(), true, config.RelayBaseURL, false)
	if err != nil {
		return err
	}
	control := &gatewayControl{dir: dir, manager: manager, disabled: disabled,
		service: standaloneService{Version: version, Platform: strings.Replace(runtime.GOOS, "darwin", "macos", 1) + "-" + runtime.GOARCH, Address: listener.Addr().String(), PID: os.Getpid(), Running: true}}
	data, err := os.ReadFile(filepath.Join(dir, "remote-access.json"))
	if err == nil {
		var saved struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.Unmarshal(data, &saved); err != nil {
			return err
		}
		control.enabled = saved.Enabled && !disabled
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := manager.Start(ctx); err != nil {
		return err
	}
	if err := manager.SetEnabled(control.enabled); err != nil {
		return err
	}
	defer manager.SetEnabled(false)
	remoteServer := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if manager.NoRelayer() {
			http.Error(w, "remote access disabled", 503)
			return
		}
		coreProxy(dir, true).ServeHTTP(w, r)
	})}
	defer remoteServer.Close()
	go remoteServer.Serve(remoteListener)
	localProxy := coreProxy(dir, false)
	localHandler := gatewayBrowserAccess(token, localProxy)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/control/") {
			localHandler.ServeHTTP(w, r)
			return
		}
		if !validGatewayToken(r.Header.Get("Authorization"), "Bearer "+token) {
			http.Error(w, "local service authorization required", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		switch {
		case r.Method == "GET" && r.URL.Path == "/control/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"protocol": 1, "mode": "standalone", "runtime_version": version, "pid": os.Getpid()})
		case r.Method == "POST" && r.URL.Path == "/control/stop":
			_, _ = w.Write([]byte("{}"))
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			cancel()
		case r.Method == "GET" && r.URL.Path == "/control/relay-status":
			_ = json.NewEncoder(w).Encode(manager.Status())
		case strings.HasPrefix(r.URL.Path, "/control/remote"):
			control.ServeHTTP(w, r)
		case r.Method == "POST" && r.URL.Path == "/control/open-project":
			localProxy.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})}
	defer server.Close()
	if err := publishStandalone(dir, listener.Addr().String(), token); err != nil {
		return err
	}
	defer os.Remove(filepath.Join(dir, "host.json"))
	addressData, _ := json.Marshal(map[string]string{"address": listener.Addr().String()})
	if err := writeStandaloneJSON(filepath.Join(dir, "gateway-address.json"), addressData); err != nil {
		return err
	}
	go func() { <-ctx.Done(); server.Close() }()
	return server.Serve(listener)
}

type standaloneService struct {
	Platform string `json:"platform"`
	Version  string `json:"version"`
	Address  string `json:"address"`
	PID      int    `json:"pid"`
	Running  bool   `json:"running"`
}

type gatewayControl struct {
	mu                sync.Mutex
	dir               string
	manager           *relay.Manager
	enabled, disabled bool
	service           standaloneService
}

func (c *gatewayControl) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var err error
	switch r.Method + " " + r.URL.Path {
	case "GET /control/remote":
	case "POST /control/remote/bind":
		err = c.setEnabled(true)
		if err == nil {
			_, err = c.manager.StartBinding()
		}
	case "POST /control/remote/enable", "POST /control/remote/host-enable":
		var enabled bool
		enabled, err = decodeRemoteEnabled(w, r)
		if err == nil {
			err = c.setEnabled(enabled)
		}
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		w.WriteHeader(503)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	status := c.manager.Status()
	_ = json.NewEncoder(w).Encode(struct {
		relay.Status
		Enabled     bool              `json:"enabled"`
		HostEnabled bool              `json:"host_enabled"`
		HostBound   bool              `json:"host_bound"`
		Service     standaloneService `json:"service"`
	}{status, c.enabled, c.enabled, status.Bound, c.service})
}

func (c *gatewayControl) setEnabled(enabled bool) error {
	if enabled && c.disabled {
		return errors.New("remote access was disabled with -no-relayer; restart without that flag to enable it")
	}
	data, err := json.Marshal(map[string]bool{"enabled": enabled})
	if err != nil {
		return err
	}
	if err := writeStandaloneJSON(filepath.Join(c.dir, "remote-access.json"), data); err != nil {
		return err
	}
	c.enabled = enabled
	return c.manager.SetEnabled(enabled)
}

func coreProxy(dir string, remote bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d, err := backend.ReadCore(dir)
		if err != nil {
			http.Error(w, "local data service unavailable", 503)
			return
		}
		address := d.URL
		if remote {
			address = d.RemoteURL
		}
		target, err := url.Parse(address)
		if err != nil || target.Host == "" {
			http.Error(w, "invalid local data service address", 503)
			return
		}
		proxy := &httputil.ReverseProxy{Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(target)
			p.Out.Host = target.Host
			p.Out.Header.Del("Cookie")
			p.Out.Header.Del("Authorization")
			p.Out.Header.Del("X-MindFS-Local-CLI-Token")
			p.Out.Header.Del("X-Local-AI-Gateway")
			if p.In.Header.Get("Origin") != "" {
				p.Out.Header.Set("Origin", target.Scheme+"://"+target.Host)
			}
			if remote {
				p.Out.Header.Set("X-Local-AI-Gateway", d.Token)
			} else {
				p.Out.AddCookie(&http.Cookie{Name: localCookieName(d.Token), Value: d.Token})
				if strings.HasPrefix(p.Out.URL.Path, "/control/") {
					p.Out.Header.Set("Authorization", "Bearer "+d.Token)
				}
			}
		}, ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "local data service unavailable", 503)
		}}
		proxy.ServeHTTP(w, r)
	})
}

func gatewayBrowserAccess(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		local, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr)
		if !ok || r.Host != local.String() || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+r.Host) {
			http.Error(w, "invalid local origin", 403)
			return
		}
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method == "GET" && r.URL.Path == "/" && validGatewayToken(r.URL.Query().Get("ide_token"), token) {
			http.SetCookie(w, &http.Cookie{Name: localCookieName(token), Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			query := r.URL.Query()
			query.Del("ide_token")
			http.Redirect(w, r, "/?"+query.Encode(), http.StatusSeeOther)
			return
		}
		cookie, err := r.Cookie(localCookieName(token))
		if err != nil || !validGatewayToken(cookie.Value, token) {
			http.Error(w, "Local AI Agent session required", 401)
			return
		}
		next.ServeHTTP(w, r)
	})
}
