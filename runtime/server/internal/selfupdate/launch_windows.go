//go:build windows

package selfupdate

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
)

//go:embed update_register.ps1
var registerScript []byte

//go:embed update_run.ps1
var runScript []byte

// launchDetached registers a one-shot scheduled task that runs the install command and starts it.
// The command stops the service's own scheduled tasks, so it cannot be their child.
func launchDetached(p plan) error {
	account, err := user.Current()
	if err != nil {
		return err
	}
	powershell := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	register := filepath.Join(p.WorkDir, "register.ps1")
	runner := filepath.Join(p.WorkDir, "run.ps1")
	config := filepath.Join(p.WorkDir, "update.json")
	id := sha256.Sum256([]byte(p.Dir))
	environment := map[string]string{"IDE_AGENT_REMOTE_HOST_DIR": p.Dir}
	for _, key := range []string{"HOME", "PATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "MINDFS_RELAY_BASE_URL", "MINDFS_STATIC_DIR", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "LOCAL_AI_AGENT_DOWNLOAD_BASE_URL"} {
		if value, ok := os.LookupEnv(key); ok {
			environment[key] = value
		}
	}
	data, err := json.Marshal(map[string]any{
		"task": fmt.Sprintf("LocalAIAgent-update-%x", id[:8]), "user_id": account.Uid, "powershell": powershell, "runner": runner,
		"script_url": p.ScriptURL, "version": p.Version, "exit_file": p.ExitFile, "log": p.LogFile,
		"environment": environment,
	})
	if err != nil {
		return err
	}
	for path, body := range map[string][]byte{register: registerScript, runner: runScript, config: data} {
		if err := os.WriteFile(path, body, 0o600); err != nil {
			return err
		}
	}
	cmd := exec.Command(powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", register, config)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("register the update task: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
