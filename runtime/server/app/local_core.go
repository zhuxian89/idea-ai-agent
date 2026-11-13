package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"mindfs/server/internal/api"
	"mindfs/server/internal/backend"
	"mindfs/server/internal/relay"
	"mindfs/server/internal/remotehost"
)

func StartLocalCore(ctx context.Context, dir, version string, opts StartOptions) error {
	lease, err := backend.Acquire(dir, false)
	if err != nil {
		return err
	}
	defer lease.Close()
	if err := os.Setenv("IDE_AGENT_DATA_DIR", dir); err != nil {
		return err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return err
	}
	opts.SharedCore = true
	opts.ControlDir, opts.AccessToken, opts.Version = dir, hex.EncodeToString(secret), version
	return Start(ctx, "127.0.0.1:0", opts)
}

func coreRemoteControl(dir string, services *api.AppContext) http.Handler {
	client := remotehost.NewClient(dir)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input any
		if r.Method == http.MethodPost {
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&input); err != nil {
				http.Error(w, "invalid remote request", 400)
				return
			}
		}
		var status map[string]any
		err := client.Call(r.Context(), r.Method, strings.Replace(r.URL.Path, "/api/idea/remote", "/control/remote", 1), input, &status)
		if err != nil {
			status = map[string]any{"enabled": false, "connected": false, "host_reachable": false,
				"last_error": err.Error(), "service": map[string]any{"running": false}}
		}
		projects := make([]map[string]any, 0)
		for _, root := range services.ListRoots() {
			projects = append(projects, map[string]any{"project_id": root.ID, "name": root.Name,
				"label": root.RootPath, "enabled": true, "availability": "online"})
		}
		status["projects"] = projects
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		if err != nil && r.Method != http.MethodGet {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(status)
	})
}

func coreRelayStatus(dir string) func(context.Context) (relay.Status, error) {
	client := remotehost.NewClient(dir)
	return func(ctx context.Context) (relay.Status, error) {
		var status relay.Status
		err := client.Call(ctx, http.MethodGet, "/control/relay-status", nil, &status)
		return status, err
	}
}

func coreRemoteAccess(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !validGatewayToken(r.Header.Get("X-Local-AI-Gateway"), token) {
			http.Error(w, "remote gateway authorization required", http.StatusUnauthorized)
			return
		}
		r.Header.Del("X-Local-AI-Gateway")
		standaloneRemote(next).ServeHTTP(w, r)
	})
}

func coreDir() (string, error) {
	if dir := os.Getenv("IDE_AGENT_REMOTE_HOST_DIR"); dir != "" {
		return filepath.Abs(dir)
	}
	return remotehost.DefaultDir()
}

// Both executables accept the same core launch commands, allowing the plugin
// to start local work even when the installed remote executable is unavailable.
func RunCoreCommand(ctx context.Context, args []string, version string) (bool, error) {
	if len(args) == 0 || (args[0] != "--local-core" && args[0] != "--start-local-core" && args[0] != "--prepare-embedded-core" && args[0] != "--prepare-embedded-remote") {
		return false, nil
	}
	if err := os.Unsetenv("IDE_AGENT_TOKEN"); err != nil {
		return true, err
	}
	dir, err := coreDir()
	if err != nil {
		return true, err
	}
	if args[0] == "--prepare-embedded-core" {
		if err := backend.StopCore(ctx, dir); err != nil {
			return true, err
		}
		return true, backend.RemoveLoginService(ctx, dir, "core")
	}
	if args[0] == "--prepare-embedded-remote" {
		if err := backend.StopGateway(ctx, dir); err != nil {
			return true, err
		}
		if err := backend.UnloadLoginService(ctx, dir, "gateway"); err != nil {
			return true, err
		}
		return true, backend.RemoveLoginService(ctx, dir, "gateway")
	}
	if args[0] == "--local-core" {
		flags := flag.NewFlagSet("local data service", flag.ContinueOnError)
		config := flags.String("agent-config", "", "extra agent configuration")
		notify := flags.String("notify-script", "", "notification script")
		webPush := flags.Bool("web-push", true, "browser notifications")
		if err := flags.Parse(args[1:]); err != nil {
			return true, err
		}
		return true, StartLocalCore(ctx, dir, version, StartOptions{AgentConfigPath: *config, NotifyScript: *notify, WebPushEnabled: *webPush})
	}
	executable, err := os.Executable()
	if err != nil {
		return true, err
	}
	if err := backend.EnsureCore(ctx, dir, executable, args[1:]...); err != nil {
		return true, fmt.Errorf("start local data service: %w", err)
	}
	return true, nil
}
