package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"mindfs/server/app"
	"mindfs/server/internal/backend"
)

func unresponsiveWriter(ctx context.Context, dir string) bool {
	if dir == "" || !backend.CoreOwnsData(dir) {
		return false
	}
	probe, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_, err := backend.CoreClient(dir).Status(probe)
	var networkError net.Error
	return errors.As(err, &networkError)
}

// Called only after an explicit recovery choice, once all IDE clients have exited.
func recoverEmbeddedCore(ctx context.Context, dir string) error {
	if dir == "" {
		return fmt.Errorf("missing service directory")
	}
	// Stop the gateway before the Core so it cannot reopen the data service.
	if _, err := app.RunCoreCommand(ctx, []string{"--prepare-embedded-remote"}, ""); err != nil {
		return err
	}
	if unresponsiveWriter(ctx, dir) {
		if err := backend.UnloadLoginService(ctx, dir, "core"); err != nil {
			return err
		}
		wait, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if err := backend.WaitForCoreExit(wait, dir); err != nil {
			return err
		}
	}
	_, err := app.RunCoreCommand(ctx, []string{"--prepare-embedded-core"}, "")
	if err != nil {
		return err
	}
	lease, err := backend.Acquire(dir, true)
	if err != nil {
		return err
	}
	return lease.Close()
}
