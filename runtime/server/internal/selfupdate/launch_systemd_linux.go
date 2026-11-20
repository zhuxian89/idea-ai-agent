//go:build linux

package selfupdate

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// launchSystemd starts the install command as its own transient unit. Stopping the service kills every
// process in its control group, so a child of the service would die in the middle of the update.
// It reports false when systemd does not manage this installation, and the caller falls back to a
// detached process.
func launchSystemd(p plan, args []string) (bool, error) {
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		return false, nil
	}
	// The installation's own environment file holds exactly the PATH, HOME and credentials the
	// service was installed with; the installer refreshes it from there.
	envFile := filepath.Join(p.Dir, "systemd-gateway.env")
	if _, err := os.Stat(envFile); err != nil {
		return false, nil
	}
	systemdRun, err := exec.LookPath("systemd-run")
	if err != nil {
		return true, err
	}
	command := []string{"--collect", "--quiet",
		"--unit=local-ai-agent-update-" + strconv.FormatInt(time.Now().Unix(), 10),
		"--property=EnvironmentFile=" + envFile,
		"--property=StandardOutput=append:" + p.LogFile,
		"--property=StandardError=inherit",
	}
	cmd := exec.Command(systemdRun)
	if os.Geteuid() != 0 {
		command = append([]string{"--user"}, command...)
		if os.Getenv("XDG_RUNTIME_DIR") == "" {
			cmd.Env = append(os.Environ(), fmt.Sprintf("XDG_RUNTIME_DIR=/run/user/%d", os.Geteuid()))
		}
	}
	cmd.Args = append(append([]string{systemdRun}, command...), append([]string{"/bin/sh"}, args...)...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return true, fmt.Errorf("start transient systemd installer: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return true, nil
}
