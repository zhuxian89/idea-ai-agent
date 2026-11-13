package backend

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"mindfs/server/internal/remotehost"
)

// StopCore waits for the data writer to release its lock before a different
// backend can start. A stale descriptor is removed only under that lock.
func StopCore(ctx context.Context, dir string) error {
	if _, err := os.Stat(filepath.Join(dir, "core.json")); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	client := CoreClient(dir)
	if _, err := client.Status(ctx); err != nil {
		lease, lockErr := Acquire(dir, false)
		if lockErr != nil {
			return err
		}
		defer lease.Close()
		return os.Remove(filepath.Join(dir, "core.json"))
	}
	if err := client.Call(ctx, "POST", "/control/stop", struct{}{}, nil); err != nil {
		return err
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		lease, err := Acquire(dir, false)
		if err == nil {
			lease.Close()
			return nil
		}
		if !lockContended(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for local data service to stop: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

// StopGateway is used only when returning to the embedded remote entry.
func StopGateway(ctx context.Context, dir string) error {
	descriptor, err := remotehost.ReadDescriptor(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if descriptor.Mode != "standalone" {
		return nil
	}
	client := remotehost.NewClient(dir)
	if _, statusErr := client.Status(ctx); statusErr == nil {
		if err := client.Call(ctx, "POST", "/control/stop", struct{}{}, nil); err != nil {
			return err
		}
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if lease, err := remotehost.AcquireStandalone(dir); err == nil {
			defer lease.Close()
			if err := os.Remove(filepath.Join(dir, "host.json")); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("remote service did not finish stopping")
}
