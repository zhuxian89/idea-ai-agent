package backend

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"syscall"
)

func taskPath(dir, kind string) string {
	return filepath.Join(dir, "login-tasks", kind+".json")
}

func writeScheduledTask(dir, kind, executable string, args []string) error {
	account, err := user.Current()
	if err != nil {
		return err
	}
	id := sha256.Sum256([]byte(filepath.Clean(dir)))
	logName := "core.log"
	if kind == "gateway" {
		logName = "standalone.log"
	}
	environment := map[string]string{"IDE_AGENT_REMOTE_HOST_DIR": dir}
	for _, key := range []string{"PATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "MINDFS_RELAY_BASE_URL", "MINDFS_STATIC_DIR", "CODEX_HOME", "CLAUDE_CONFIG_DIR"} {
		if value, ok := os.LookupEnv(key); ok {
			environment[key] = value
		}
	}
	config := scheduledTaskConfig{
		Name: fmt.Sprintf("LocalAIAgent-%x-%s", id[:8], kind), UserID: account.Uid,
		PowerShell: filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
		Runner:     filepath.Join(dir, "login-tasks", "run.ps1"), Executable: executable,
		Arguments: args, Environment: environment, Log: filepath.Join(dir, "logs", logName),
	}
	data, err := json.Marshal(config)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(config.Log), 0700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(config.Runner), 0700); err != nil {
		return err
	}
	for name, body := range map[string][]byte{"run.ps1": scheduledTaskRunner, "control.ps1": scheduledTaskControl, kind + ".json": data} {
		if err := os.WriteFile(filepath.Join(dir, "login-tasks", name), body, 0600); err != nil {
			return err
		}
	}
	return nil
}

// savedTaskArguments returns the arguments recorded in an existing task definition,
// so a reinstall keeps the options the user already started the job with.
func savedTaskArguments(dir, kind string) ([]string, bool, error) {
	data, err := os.ReadFile(filepath.Join(dir, "login-tasks", kind+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var saved scheduledTaskConfig
	if err := json.Unmarshal(data, &saved); err != nil {
		return nil, false, fmt.Errorf("read scheduled task %s: %w", kind, err)
	}
	return saved.Arguments, len(saved.Arguments) > 0, nil
}

func InstallLoginServices(dir, executable string) error {
	for _, kind := range []string{"core", "gateway"} {
		args := []string{"--local-core"}
		if kind == "gateway" {
			args = []string{"-foreground", "-no-browser"}
			// An upgrade runs -install again; keep the options already chosen for this job.
			if saved, found, err := savedTaskArguments(dir, kind); err != nil {
				return err
			} else if found {
				args = saved
			}
		}
		if err := writeScheduledTask(dir, kind, executable, args); err != nil {
			return err
		}
		if err := runScheduledTask(context.Background(), dir, kind, "install"); err != nil {
			return err
		}
	}
	return nil
}

func StartLoginService(ctx context.Context, dir, kind, executable string, args []string) (bool, error) {
	if _, err := os.Stat(taskPath(dir, kind)); errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return true, err
	}
	args, err := loginServiceArguments(dir, kind, args)
	if err != nil {
		return true, err
	}
	if err := writeScheduledTask(dir, kind, executable, args); err != nil {
		return true, err
	}
	return true, runScheduledTask(ctx, dir, kind, "start")
}

func UnloadLoginService(ctx context.Context, dir, kind string) error {
	if _, err := os.Stat(taskPath(dir, kind)); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return runScheduledTask(ctx, dir, kind, "stop")
}

func RemoveLoginServices(ctx context.Context, dir string) error {
	for _, kind := range []string{"gateway", "core"} {
		if err := RemoveLoginService(ctx, dir, kind); err != nil {
			return err
		}
	}
	return nil
}

func RemoveLoginService(ctx context.Context, dir, kind string) error {
	if _, err := os.Stat(taskPath(dir, kind)); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := runScheduledTask(ctx, dir, kind, "remove"); err != nil {
		return err
	}
	return os.Remove(taskPath(dir, kind))
}

func runScheduledTask(ctx context.Context, dir, kind, operation string) error {
	powershell := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	command := exec.CommandContext(ctx, powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-File", filepath.Join(dir, "login-tasks", "control.ps1"), operation, taskPath(dir, kind))
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("scheduled task %s %s: %w: %s", kind, operation, err, output)
	}
	return nil
}
