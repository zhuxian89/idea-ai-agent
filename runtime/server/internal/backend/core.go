package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"mindfs/server/internal/remotehost"
)

// The core owns project data. The remote gateway has a separate descriptor and
// lifetime, so restarting remote access never rotates the IDE's login token.
func CoreClient(dir string) *remotehost.Client {
	client := remotehost.NewClient(dir)
	client.DescriptorName = "core.json"
	return client
}

func ReadCore(dir string) (remotehost.Descriptor, error) {
	return remotehost.ReadDescriptorFile(dir, "core.json")
}

func PublishCore(dir, address, remoteAddress, token string) error {
	d := remotehost.Descriptor{Protocol: remotehost.Protocol, URL: "http://" + address,
		RemoteURL: "http://" + remoteAddress, Token: token, Mode: "core"}
	data, err := json.Marshal(d)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "core.json")
	if err := os.WriteFile(path+".tmp", data, 0600); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}

// Called by a short-lived launcher, not by the IDE-owned project process.
// Exiting the launcher leaves the data service independent of the remote gateway.
func EnsureCore(ctx context.Context, dir, executable string, options ...string) error {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	client := CoreClient(dir)
	if _, err := client.Status(ctx); err == nil {
		return nil
	}
	// Multiple IDEA projects can start together. Serialize only core creation;
	// the core itself continues to own the existing exclusive data lock.
	for {
		lease, err := Acquire(filepath.Join(dir, "core-start"), false)
		if err == nil {
			defer lease.Close()
			break
		}
		if !lockContended(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	if _, err := client.Status(ctx); err == nil {
		return nil
	}
	args := append([]string{"--local-core"}, options...)
	managed, err := StartLoginService(ctx, dir, "core", executable, args)
	if err != nil {
		return err
	}
	var done <-chan error
	if !managed {
		if err := os.MkdirAll(filepath.Join(dir, "logs"), 0700); err != nil {
			return err
		}
		log, err := os.OpenFile(filepath.Join(dir, "logs", "core.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		child := exec.Command(executable, args...)
		child.Env = append(os.Environ(), "IDE_AGENT_REMOTE_HOST_DIR="+dir, "IDE_AGENT_DATA_DIR="+dir)
		child.Stdout, child.Stderr = log, log
		Detach(child)
		err = child.Start()
		log.Close()
		if err != nil {
			return err
		}
		exited := make(chan error, 1)
		go func() { exited <- child.Wait() }()
		done = exited
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(20 * time.Second)
	defer timeout.Stop()
	for {
		if _, err := client.Status(ctx); err == nil {
			return nil
		}
		select {
		case err := <-done:
			// Another launcher can win the core's exclusive data lock.
			if _, statusErr := client.Status(ctx); statusErr == nil {
				return nil
			}
			return fmt.Errorf("local data service exited (%v); see %s", err, filepath.Join(dir, "logs", "core.log"))
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout.C:
			return fmt.Errorf("local data service startup timed out; see %s", filepath.Join(dir, "logs", "core.log"))
		case <-ticker.C:
		}
	}
}
