package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"mindfs/server/internal/relay"
	"mindfs/server/internal/remotehost"
)

func printRemoteBinding(ctx context.Context, client *remotehost.Client, output io.Writer) error {
	var status struct {
		relay.Status
		Enabled bool `json:"enabled"`
	}
	if err := client.Call(ctx, http.MethodGet, "/control/remote", nil, &status); err != nil {
		return fmt.Errorf("read Relay status: %w", err)
	}
	if !status.Bound && status.PendingCode == "" {
		if err := client.Call(ctx, http.MethodPost, "/control/remote/bind", struct{}{}, &status); err != nil {
			return fmt.Errorf("start Relay binding: %w", err)
		}
	}
	if status.Bound {
		state := "bound, waiting for the node to come online"
		switch {
		case !status.Enabled:
			state = "bound, remote access paused"
		case status.Connected:
			state = "connected"
		}
		fmt.Fprintf(output, "Relay: %s\n", state)
		if status.NodeName != "" {
			fmt.Fprintf(output, "Node: %s\n", status.NodeName)
		}
		if status.NodeURL != "" {
			fmt.Fprintln(output, status.NodeURL)
		}
		return nil
	}
	if status.RelayBaseURL == "" || status.PendingCode == "" {
		return fmt.Errorf("Relay did not provide a binding link")
	}
	query := url.Values{"code": {status.PendingCode}}
	link := strings.TrimRight(status.RelayBaseURL, "/") + "/bind?" + query.Encode()
	fmt.Fprintf(output, "Open this link on your phone or computer to sign in and bind this server:\n%s\n", link)
	return nil
}
