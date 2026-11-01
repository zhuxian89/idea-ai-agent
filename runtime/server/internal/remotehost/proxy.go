package remotehost

import (
	"context"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type projectRoute struct {
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.Mutex
	closed      bool
	connections map[*routeConn]struct{}
	transport   *http.Transport
	proxy       *httputil.ReverseProxy
}
type routeConn struct {
	net.Conn
	route *projectRoute
	once  sync.Once
}

func (c *routeConn) Close() error {
	err := c.Conn.Close()
	c.once.Do(func() { c.route.mu.Lock(); delete(c.route.connections, c); c.route.mu.Unlock() })
	return err
}
func newProjectRoute(address, token string) *projectRoute {
	target, _ := url.Parse(address)
	ctx, cancel := context.WithCancel(context.Background())
	p := &projectRoute{ctx: ctx, cancel: cancel, connections: map[*routeConn]struct{}{}}
	transport := &http.Transport{Proxy: nil, ResponseHeaderTimeout: 30 * time.Second, IdleConnTimeout: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		wrapped := &routeConn{Conn: conn, route: p}
		p.mu.Lock()
		if p.closed {
			p.mu.Unlock()
			conn.Close()
			return nil, context.Canceled
		}
		p.connections[wrapped] = struct{}{}
		p.mu.Unlock()
		return wrapped, nil
	}
	p.transport = transport
	p.proxy = &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) {
		// Keep the escaped /p/P prefix unchanged: the project verifies this signed
		// path before dispatching its original unprefixed business routes.
		r.Out.URL.Scheme = target.Scheme
		r.Out.URL.Host = target.Host
		r.Out.Host = target.Host
		r.Out.Header.Del(ProjectTokenHeader)
		r.Out.Header.Set(ProjectTokenHeader, token)
		r.Out.Header.Del("Authorization")
		r.Out.Header.Del("Cookie")
		r.Out.Header.Del("X-MindFS-Local-CLI-Token")
		r.Out.Header.Del("X-IDE-Agent-Token")
		// Relay has already rewritten WS Origin to this host's loopback entry.
		// This second trusted hop must target the project's loopback origin;
		// the project still requires its host credential and browser E2EE proof.
		if r.In.Header.Get("Origin") != "" {
			r.Out.Header.Set("Origin", target.Scheme+"://"+target.Host)
		}
	}, ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
		jsonResponse(w, 503, map[string]string{"error": "project_offline"})
	}}
	return p
}
func (p *projectRoute) close() {
	p.cancel()
	p.mu.Lock()
	p.closed = true
	connections := make([]*routeConn, 0, len(p.connections))
	for c := range p.connections {
		connections = append(connections, c)
	}
	p.mu.Unlock()
	for _, c := range connections {
		c.Close()
	}
	p.transport.CloseIdleConnections()
}
func (h *host) proxyProject(w http.ResponseWriter, r *http.Request) {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.EscapedPath(), "/p/"), "/", 2)
	if len(parts) != 2 || parts[0] == "" || strings.Contains(parts[0], "%") {
		apiError(w, &APIError{400, "invalid_project_route"})
		return
	}
	h.mu.Lock()
	p, err := h.availableLocked(parts[0])
	if !h.state.Enabled {
		err = &APIError{503, "remote_access_disabled"}
	}
	if err != nil {
		h.mu.Unlock()
		// A deep-link reload must load enough UI to explain why P is unavailable.
		// Only the navigation shell/assets have this behavior, never project data.
		if (r.Method == http.MethodGet || r.Method == http.MethodHead) && (parts[1] == "" || strings.HasPrefix(parts[1], "assets/")) {
			if parts[1] == "" {
				http.ServeFile(w, r, filepath.Join(h.staticDir, "index.html"))
				return
			}
			clone := r.Clone(r.Context())
			clone.URL.Path = "/" + strings.TrimPrefix(r.URL.Path, "/p/"+parts[0]+"/")
			clone.URL.RawPath = ""
			http.FileServer(http.Dir(h.staticDir)).ServeHTTP(w, clone)
			return
		}
		apiError(w, err)
		return
	}
	if p.route == nil {
		p.route = newProjectRoute(p.Address, p.Token)
	}
	route := p.route
	h.mu.Unlock()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(route.ctx, cancel)
	defer stop()
	route.proxy.ServeHTTP(w, r.WithContext(ctx))
}
