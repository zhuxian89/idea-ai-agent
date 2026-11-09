package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"mindfs/server/app"
	"mindfs/server/internal/agent"
	"mindfs/server/internal/logfile"
	"mindfs/server/internal/remotehost"
)

func main() {
	accessToken, err := takeAccessToken()
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot isolate IDE access token:", err)
		os.Exit(1)
	}
	project := flag.String("project", "", "IDE project directory")
	remoteHost := flag.Bool("remote-host", false, "Shared remote entry for this OS user")
	flag.Parse()
	// The plugin discards stderr (it can carry credentials), so keep diagnostics
	// in a bounded file under the data directory instead.
	closeLog := openRuntimeLog(*remoteHost)
	defer closeLog()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if *remoteHost {
		err := runRemoteHost(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	// The project host owns stdin; EOF shuts down its runtime after an IDE crash.
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			if scanner.Text() == "shutdown" {
				break
			}
		}
		cancel()
	}()
	root, err := filepath.Abs(*project)
	if err != nil || *project == "" {
		fmt.Fprintln(os.Stderr, "--project must name an existing directory")
		os.Exit(1)
	}
	err = app.Start(ctx, "127.0.0.1:0", app.StartOptions{
		LocalOnly: true, ProjectRoot: root, AccessToken: accessToken, Version: "idea-0.1.0",
		OnReady: func(address, rootID string) error {
			data, err := json.Marshal(map[string]string{"url": "http://" + address, "rootId": rootID})
			if err != nil {
				return err
			}
			_, err = fmt.Fprintln(os.Stdout, "IDE_AGENT_READY "+string(data))
			return err
		},
	})
	if err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

const runtimeLogMaxBytes = 2 << 20

// openRuntimeLog redirects the standard logger to <data dir>/logs/runtime.log.
// Failing to open it must not stop the runtime: keep logging to stderr.
func openRuntimeLog(remoteHost bool) func() {
	dir := os.Getenv("IDE_AGENT_DATA_DIR")
	name := "runtime.log"
	if remoteHost {
		dir, name = os.Getenv("IDE_AGENT_REMOTE_HOST_DIR"), "remote-host.log"
	}
	if dir == "" {
		return func() {}
	}
	writer, err := logfile.Open(filepath.Join(dir, "logs", name), runtimeLogMaxBytes)
	if err != nil {
		return func() {}
	}
	log.SetOutput(writer)
	return func() { log.SetOutput(os.Stderr); writer.Close() }
}

// Keep the host credential out of every Agent, probe and terminal environment.
func takeAccessToken() (string, error) {
	token := os.Getenv("IDE_AGENT_TOKEN")
	return token, os.Unsetenv("IDE_AGENT_TOKEN")
}

func runRemoteHost(ctx context.Context) error {
	dir := os.Getenv("IDE_AGENT_REMOTE_HOST_DIR")
	if dir == "" {
		var err error
		dir, err = remotehost.DefaultDir()
		if err != nil {
			return err
		}
	}
	if err := os.Setenv("IDE_AGENT_DATA_DIR", dir); err != nil {
		return err
	}
	config, err := agent.LoadConfigWithExtra("")
	if err != nil {
		return err
	}
	return remotehost.Run(ctx, remotehost.Options{
		Dir: dir, StaticDir: os.Getenv("MINDFS_STATIC_DIR"), RelayBaseURL: config.RelayBaseURL,
		RuntimeVersion: os.Getenv("IDE_AGENT_REMOTE_VERSION"),
		OnReady: func(descriptor remotehost.Descriptor) error {
			payload, err := json.Marshal(descriptor)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintln(os.Stdout, "IDEA_REMOTE_HOST_READY "+string(payload))
			return err
		},
	})
}
