package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"mindfs/server/app"
)

func main() {
	accessToken, err := takeAccessToken()
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot isolate IDE access token:", err)
		os.Exit(1)
	}
	project := flag.String("project", "", "IDE project directory")
	flag.Parse()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	// The host owns stdin; EOF also shuts down the server after an IDE crash.
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

// Keep the host credential out of every Agent, probe and terminal environment.
func takeAccessToken() (string, error) {
	token := os.Getenv("IDE_AGENT_TOKEN")
	return token, os.Unsetenv("IDE_AGENT_TOKEN")
}
