package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"mindfs/server/internal/backend"
	"mindfs/server/internal/remotehost"
)

// IDEA's forwarding host stays alive briefly after its last project closes.
// Take the data lease before stopping it, so an open project is never displaced.
func stopIdleIDEHost(ctx context.Context, dir string) error {
	dataLease, err := backend.Acquire(dir, false)
	if err != nil {
		return err
	}
	defer dataLease.Close()
	client := remotehost.NewClient(dir)
	status, statusErr := client.Status(ctx)
	if statusErr == nil {
		if err := client.Call(ctx, "POST", "/control/upgrade-stop", map[string]string{"runtime_version": status.RuntimeVersion}, nil); err != nil {
			return err
		}
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		if lease, err := remotehost.AcquireStandalone(dir); err == nil {
			defer lease.Close()
			if err := os.Remove(filepath.Join(dir, "host.json")); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			return nil
		}
		if statusErr != nil {
			return statusErr
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the IDEA remote host did not finish stopping")
		}
		time.Sleep(100 * time.Millisecond)
	}
}
