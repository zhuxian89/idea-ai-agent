package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"mindfs/server/app"
	"mindfs/server/internal/backend"
	"mindfs/server/internal/remotehost"
)

// Managed jobs and the data service start from another working directory, so a path
// the user typed must be resolved here, where it is relative to their own shell.
func resolveUserPaths(paths ...*string) error {
	for _, path := range paths {
		if *path == "" {
			continue
		}
		absolute, err := filepath.Abs(*path)
		if err != nil {
			return err
		}
		*path = absolute
	}
	return nil
}

func runCLI(args []string) error {
	coreCtx, cancelCore := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancelCore()
	if handled, err := app.RunCoreCommand(coreCtx, args, version); handled {
		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
	flags := flag.NewFlagSet("Local AI Agent", flag.ContinueOnError)
	addr := flags.String("addr", "127.0.0.1:0", "local browser address (automatically assigned on first start)")
	foreground := flags.Bool("foreground", false, "run the shared backend in this terminal")
	noBrowser := flags.Bool("no-browser", false, "do not open a browser")
	status := flags.Bool("status", false, "show the shared backend status")
	stop := flags.Bool("stop", false, "stop the shared backend for all projects")
	stopCore := flags.Bool("stop-core", false, "stop the local data service before updating its executable")
	restart := flags.Bool("restart", false, "restart the shared backend for all projects")
	install := flags.Bool("install", false, "record this executable for IDEA discovery")
	installationDir := flags.Bool("installation-dir", false, "print the registered installation directory")
	uninstall := flags.Bool("unregister", false, "remove IDEA discovery after stopping the service")
	showVersion := flags.Bool("version", false, "show the version")
	noRelayer := flags.Bool("no-relayer", false, "disable remote access")
	webPush := flags.Bool("web-push", true, "enable browser notifications")
	config := flags.String("config", "", "startup config file")
	agentConfig := flags.String("agent-config", "", "extra agents.json file")
	notify := flags.String("notify-script", "", "notification script")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *showVersion {
		fmt.Println("Local AI Agent", version)
		return nil
	}
	if flags.NArg() > 1 {
		return fmt.Errorf("expected at most one project directory")
	}
	cfg, err := loadStartupConfig(*config)
	if err != nil {
		return err
	}
	applyStartupConfig(cfg, visitedFlags(flags), addr, noRelayer, webPush, agentConfig, notify)
	if err := resolveUserPaths(agentConfig, notify); err != nil {
		return err
	}
	dir := os.Getenv("IDE_AGENT_REMOTE_HOST_DIR")
	if dir == "" {
		dir, err = remotehost.DefaultDir()
	}
	if err != nil {
		return err
	}
	if *installationDir {
		data, err := os.ReadFile(filepath.Join(dir, "installation.json"))
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		var installed backend.Installation
		if err := json.Unmarshal(data, &installed); err != nil {
			return err
		}
		if !filepath.IsAbs(installed.Executable) {
			return fmt.Errorf("invalid executable in installation.json")
		}
		fmt.Println(filepath.Dir(installed.Executable))
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if *install {
		if err := backend.RecordInstallation(dir, executable); err != nil {
			return err
		}
		return backend.InstallLoginServices(dir, executable)
	}
	if *stopCore {
		return stopLocalCore(coreCtx, dir)
	}

	if !visitedFlags(flags)["addr"] && cfg.Addr == nil {
		if data, readErr := os.ReadFile(filepath.Join(dir, "gateway-address.json")); readErr == nil {
			var saved struct {
				Address string `json:"address"`
			}
			if err := json.Unmarshal(data, &saved); err != nil {
				return err
			}
			*addr = saved.Address
		} else if !errors.Is(readErr, os.ErrNotExist) {
			return readErr
		}
	}
	client := remotehost.NewClient(dir)
	ctx := context.Background()
	descriptor, descriptorErr := remotehost.ReadDescriptor(dir)
	if descriptorErr != nil && !errors.Is(descriptorErr, os.ErrNotExist) {
		return descriptorErr
	}
	if descriptorErr == nil && descriptor.Mode != "standalone" {
		if *status {
			return fmt.Errorf("the IDEA remote host is running")
		}
		if err := stopIdleIDEHost(ctx, dir); err != nil {
			return err
		}
		descriptorErr = os.ErrNotExist
	}
	running := false
	if descriptorErr == nil {
		_, statusErr := client.Status(ctx)
		running = statusErr == nil
		// Versions before .4 only stored the bound address in the live descriptor.
		if running && (*stop || *restart || *uninstall) {
			if _, err := os.Stat(filepath.Join(dir, "gateway-address.json")); errors.Is(err, os.ErrNotExist) {
				address, err := url.Parse(descriptor.URL)
				if err != nil {
					return err
				}
				data, err := json.Marshal(map[string]string{"address": address.Host})
				if err != nil {
					return err
				}
				if err := os.WriteFile(filepath.Join(dir, "gateway-address.json"), data, 0600); err != nil {
					return err
				}
				if !visitedFlags(flags)["addr"] && cfg.Addr == nil {
					*addr = address.Host
				}
			}
		}
		if *status && statusErr != nil {
			return fmt.Errorf("Local AI Agent is not responding: %w", statusErr)
		}
	}
	if *status {
		if !running {
			return fmt.Errorf("Local AI Agent is stopped")
		}
		fmt.Println("Local AI Agent", version, "running at", descriptor.URL)
		return nil
	}
	if descriptorErr == nil && !running {
		// A crash can leave host.json behind. Only its next lock owner may
		// remove it; an unreachable process that still owns data is never replaced.
		hostLease, err := remotehost.AcquireStandalone(dir)
		if err == nil {
			err = os.Remove(filepath.Join(dir, "host.json"))
			hostLease.Close()
		}
		if err != nil {
			return err
		}
		descriptorErr = os.ErrNotExist
	}
	if *stop || *restart || *uninstall {
		if running {
			if err := client.Call(ctx, "POST", "/control/stop", struct{}{}, nil); err != nil {
				return err
			}
			deadline := time.Now().Add(10 * time.Second)
			for {
				if _, err := os.Stat(filepath.Join(dir, "host.json")); errors.Is(err, os.ErrNotExist) {
					lease, lockErr := remotehost.AcquireStandalone(dir)
					if lockErr == nil {
						lease.Close()
						break
					}
				}
				if time.Now().After(deadline) {
					return fmt.Errorf("Local AI Agent did not finish stopping")
				}
				time.Sleep(100 * time.Millisecond)
			}
		}
		if err := backend.UnloadLoginService(ctx, dir, "gateway"); err != nil {
			return err
		}
		if *uninstall {
			if err := stopLocalCore(ctx, dir); err != nil {
				return err
			}
			if err := backend.RemoveLoginServices(ctx, dir); err != nil {
				return err
			}
			if err := os.Remove(filepath.Join(dir, "installation.json")); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			return nil
		}
		if *stop {
			return nil
		}
		running = false
	}
	if *foreground {
		if running {
			return fmt.Errorf("Local AI Agent is already running")
		}
		return serveStandalone(dir, executable, *addr, flags.Arg(0), *agentConfig, *notify, *webPush, *noRelayer)
	}
	if !running {
		if err := os.MkdirAll(filepath.Join(dir, "logs"), 0700); err != nil {
			return err
		}
		childArgs := []string{"-foreground", "-no-browser", "-addr", *addr, "-web-push=" + fmt.Sprint(*webPush), "-no-relayer=" + fmt.Sprint(*noRelayer)}
		if *agentConfig != "" {
			childArgs = append(childArgs, "-agent-config", *agentConfig)
		}
		if *notify != "" {
			childArgs = append(childArgs, "-notify-script", *notify)
		}
		if flags.NArg() == 1 {
			project, err := filepath.Abs(flags.Arg(0))
			if err != nil {
				return err
			}
			childArgs = append(childArgs, project)
		}
		managed, err := backend.StartLoginService(ctx, dir, "gateway", executable, childArgs)
		if err != nil {
			return err
		}
		if !managed {
			log, err := os.OpenFile(filepath.Join(dir, "logs", "standalone.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
			if err != nil {
				return err
			}
			child := exec.Command(executable, childArgs...)
			child.Stdout, child.Stderr = log, log
			detach(child)
			err = child.Start()
			log.Close()
			if err != nil {
				return err
			}
			defer child.Process.Release()
		}
		deadline := time.Now().Add(15 * time.Second)
		for {
			if _, err := client.Status(ctx); err == nil {
				break
			}
			if time.Now().After(deadline) {
				return fmt.Errorf("Local AI Agent did not start; see %s", filepath.Join(dir, "logs", "standalone.log"))
			}
			time.Sleep(100 * time.Millisecond)
		}
		descriptor, err = remotehost.ReadDescriptor(dir)
		if err != nil {
			return err
		}
	}
	rootID := ""
	if flags.NArg() == 1 {
		path, err := filepath.Abs(flags.Arg(0))
		if err != nil {
			return err
		}
		var opened struct {
			RootID string `json:"root_id"`
		}
		if err := client.Call(ctx, "POST", "/control/open-project", map[string]string{"path": path}, &opened); err != nil {
			return err
		}
		rootID = opened.RootID
	}
	fmt.Println("Local AI Agent running at", descriptor.URL)
	if !*noBrowser {
		login := descriptor.URL + "/?" + url.Values{"ide_token": {descriptor.Token}, "root": {rootID}}.Encode()
		return openBrowser(login)
	}
	return nil
}

func serveStandalone(dir, executable, addr, root, agentConfig, notify string, webPush, noRelayer bool) error {
	hostLease, err := remotehost.AcquireStandalone(dir)
	if err != nil {
		return err
	}
	defer hostLease.Close()
	if err := backend.RecordInstallation(dir, executable); err != nil {
		return err
	}
	if err := os.Setenv("IDE_AGENT_DATA_DIR", dir); err != nil {
		return err
	}
	if root != "" {
		root, err = filepath.Abs(root)
		if err != nil {
			return err
		}
		root, err = filepath.EvalSymlinks(root)
		if err != nil {
			return err
		}
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	// Windows PowerShell drops separate empty arguments when launching native programs.
	if err := backend.EnsureCore(ctx, dir, executable, "--agent-config="+agentConfig, "--notify-script="+notify, "--web-push="+fmt.Sprint(webPush)); err != nil {
		return err
	}
	if root != "" {
		if err := backend.CoreClient(dir).Call(ctx, "POST", "/control/open-project", map[string]string{"path": root}, nil); err != nil {
			return err
		}
	}
	err = app.StartRemoteGateway(ctx, dir, addr, version, hex.EncodeToString(secret), noRelayer)
	if errors.Is(err, http.ErrServerClosed) || errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

func openBrowser(address string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", address)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
	default:
		command = exec.Command("xdg-open", address)
	}
	return command.Run()
}

func stopLocalCore(coreCtx context.Context, dir string) error {
	if err := stopLocalCoreProcess(coreCtx, dir); err != nil {
		return err
	}
	return backend.UnloadLoginService(coreCtx, dir, "core")
}

func stopLocalCoreProcess(coreCtx context.Context, dir string) error {
	return backend.StopCore(coreCtx, dir)
}
