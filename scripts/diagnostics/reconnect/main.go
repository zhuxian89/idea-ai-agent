package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

//go:embed browser.js
var browserScript []byte

type recorder struct {
	mu      sync.Mutex
	encoder *json.Encoder
}

func (r *recorder) write(event map[string]any) {
	event["observed_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	r.mu.Lock()
	defer r.mu.Unlock()
	_ = r.encoder.Encode(event)
}

func clip(s string, limit int) string {
	if len(s) > limit {
		return s[:limit]
	}
	return s
}

type observerTransport struct {
	base http.RoundTripper
	log  *recorder
	next atomic.Int64
}

func (t *observerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	started := time.Now()
	upgrading := strings.EqualFold(req.Header.Get("Upgrade"), "websocket")
	var id int64
	client := clip(req.URL.Query().Get("client_id"), 100)
	if upgrading {
		id = t.next.Add(1)
		t.log.write(map[string]any{"source": "core_socket", "kind": "handshake_started", "connection": id, "client": client})
	}
	resp, err := t.base.RoundTrip(req)
	if upgrading && (err != nil || resp.StatusCode != http.StatusSwitchingProtocols) {
		event := map[string]any{"source": "core_socket", "kind": "handshake_failed", "connection": id, "client": client, "handshake_ms": time.Since(started).Milliseconds()}
		if resp != nil {
			event["status"] = resp.StatusCode
		}
		t.log.write(event)
	}
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		return resp, nil
	}
	body, ok := resp.Body.(io.ReadWriteCloser)
	if !ok {
		return resp, nil
	}
	emit := func(direction string) func(map[string]any) {
		return func(event map[string]any) {
			event["source"], event["direction"], event["connection"], event["client"] = "core_socket", direction, id, client
			t.log.write(event)
		}
	}
	t.log.write(map[string]any{"source": "core_socket", "kind": "upgraded", "connection": id, "client": client, "handshake_ms": time.Since(started).Milliseconds()})
	resp.Body = &observedBody{ReadWriteCloser: body, read: frameObserver{emit: emit("from_core")}, write: frameObserver{emit: emit("to_core")}}
	return resp, nil
}

type clientEvent struct {
	Page     string  `json:"page"`
	Seq      int     `json:"seq"`
	At       float64 `json:"at"`
	Mono     float64 `json:"mono"`
	Kind     string  `json:"kind"`
	Socket   int     `json:"socket,omitempty"`
	Client   string  `json:"client,omitempty"`
	Probe    string  `json:"probe,omitempty"`
	AgeMS    float64 `json:"age_ms,omitempty"`
	RxGapMS  float64 `json:"rx_gap_ms,omitempty"`
	LagMS    float64 `json:"lag_ms,omitempty"`
	Buffered float64 `json:"buffered,omitempty"`
	State    int     `json:"state,omitempty"`
	Hidden   bool    `json:"hidden"`
	Code     int     `json:"code,omitempty"`
	Clean    bool    `json:"clean,omitempty"`
}

func diagnosticHandler(target *url.URL, token string, log *recorder) http.Handler {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	proxy := &httputil.ReverseProxy{
		Transport: &observerTransport{base: transport, log: log},
		Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(target)
			p.Out.Host = target.Host
			if p.In.Header.Get("Origin") != "" {
				p.Out.Header.Set("Origin", target.Scheme+"://"+target.Host)
			}
			if isPage(p.In) {
				p.Out.Header.Set("Accept-Encoding", "identity")
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			if !isPage(resp.Request) || resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
				return nil
			}
			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				return err
			}
			body = bytes.Replace(body, []byte("<head>"), []byte("<head><script src=\"./__connection_observer.js\"></script>"), 1)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			resp.ContentLength = int64(len(body))
			resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
			resp.Header.Set("Cache-Control", "no-store")
			resp.Header.Del("ETag")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.write(map[string]any{"source": "observer", "kind": "proxy_error", "error": err.Error()})
			http.Error(w, "diagnostic proxy upstream error", 502)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Local-AI-Gateway")), []byte(token)) != 1 {
			http.Error(w, "invalid gateway credential", 403)
			return
		}
		switch {
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/__connection_observer.js"):
			w.Header().Set("Content-Type", "application/javascript")
			w.Header().Set("Cache-Control", "no-store")
			w.Write(browserScript)
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/__connection_observer"):
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
			decoder.DisallowUnknownFields()
			var events []clientEvent
			if err := decoder.Decode(&events); err != nil || len(events) > 30 {
				http.Error(w, "invalid diagnostic batch", 400)
				return
			}
			for _, event := range events {
				event.Page, event.Client = clip(event.Page, 100), clip(event.Client, 100)
				event.Probe, event.Kind = clip(event.Probe, 100), clip(event.Kind, 40)
				log.write(map[string]any{"source": "browser", "event": event})
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			proxy.ServeHTTP(w, r)
		}
	})
}

func isPage(r *http.Request) bool {
	return r.Method == "GET" && (r.URL.Path == "/" || (strings.HasPrefix(r.URL.Path, "/p/") && strings.HasSuffix(r.URL.Path, "/")))
}

func replaceFile(path string, data []byte) error {
	tmp := path + ".observer-tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func run() error {
	descriptor := flag.String("descriptor", "", "live core.json discovery file")
	output := flag.String("output", "", "private diagnostic directory")
	duration := flag.Duration("duration", 4*time.Hour, "observation duration before restoring discovery")
	flag.Parse()
	if *descriptor == "" || *output == "" {
		return errors.New("descriptor and output are required")
	}
	original, err := os.ReadFile(*descriptor)
	if err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(original, &fields); err != nil {
		return err
	}
	var remoteURL, token string
	if err := json.Unmarshal(fields["remote_url"], &remoteURL); err != nil {
		return err
	}
	if err := json.Unmarshal(fields["token"], &token); err != nil {
		return err
	}
	target, err := url.Parse(remoteURL)
	if err != nil || target.Scheme != "http" || target.Hostname() != "127.0.0.1" || len(token) < 32 {
		return errors.New("expected an authenticated loopback Core")
	}
	if err := os.MkdirAll(*output, 0700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(*output, "core.before.json"), original, 0600); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(*output, "events.jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	log := &recorder{encoder: json.NewEncoder(file)}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	address := "http://" + listener.Addr().String()
	fields["remote_url"], _ = json.Marshal(address)
	installed, err := json.MarshalIndent(fields, "", "  ")
	if err != nil {
		return err
	}
	installed = append(installed, '\n')
	current, err := os.ReadFile(*descriptor)
	if err != nil {
		return err
	}
	if !bytes.Equal(current, original) {
		return errors.New("Core discovery changed before observation started")
	}
	server := &http.Server{Handler: diagnosticHandler(target, token, log), ReadHeaderTimeout: 5 * time.Second}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	ctx, expire := context.WithTimeout(ctx, *duration)
	defer expire()
	go func() { <-ctx.Done(); server.Close() }()
	if err := replaceFile(*descriptor, installed); err != nil {
		return err
	}
	defer func() {
		current, readErr := os.ReadFile(*descriptor)
		if readErr == nil && bytes.Equal(current, installed) {
			if restoreErr := replaceFile(*descriptor, original); restoreErr != nil {
				log.write(map[string]any{"source": "observer", "kind": "restore_failed", "error": restoreErr.Error()})
				return
			}
			log.write(map[string]any{"source": "observer", "kind": "discovery_restored"})
		}
	}()
	metadata, _ := json.MarshalIndent(map[string]any{"pid": os.Getpid(), "address": address, "target": target.String(), "started_at": time.Now().UTC().Format(time.RFC3339), "duration": duration.String()}, "", "  ")
	if err := os.WriteFile(filepath.Join(*output, "observer.json"), metadata, 0600); err != nil {
		return err
	}
	log.write(map[string]any{"source": "observer", "kind": "started", "pid": os.Getpid()})
	go sampleServices(ctx, filepath.Dir(*descriptor), address, log)
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
