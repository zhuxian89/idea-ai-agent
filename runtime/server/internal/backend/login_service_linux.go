package backend

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type linuxService struct {
	name, file, target string
}

func linuxServiceFor(dir, kind string) (linuxService, error) {
	unitDir, target := "/etc/systemd/system", "multi-user.target"
	if os.Geteuid() != 0 {
		config, err := os.UserConfigDir()
		if err != nil {
			return linuxService{}, err
		}
		unitDir, target = filepath.Join(config, "systemd", "user"), "default.target"
	}
	id := sha256.Sum256([]byte(filepath.Clean(dir)))
	name := fmt.Sprintf("local-ai-agent-%x-%s.service", id[:8], kind)
	return linuxService{name, filepath.Join(unitDir, name), target}, nil
}

func systemctl(ctx context.Context, args ...string) error {
	if os.Geteuid() != 0 {
		args = append([]string{"--user"}, args...)
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "systemctl", args...)
	if os.Geteuid() != 0 && os.Getenv("XDG_RUNTIME_DIR") == "" {
		cmd.Env = append(os.Environ(), fmt.Sprintf("XDG_RUNTIME_DIR=/run/user/%d", os.Geteuid()))
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func unitQuote(value string) string {
	return strconv.Quote(strings.ReplaceAll(value, "%", "%%"))
}

func (s linuxService) write(dir, kind, executable string, args []string, installing bool) (bool, error) {
	previous, err := os.ReadFile(s.file)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	quoted := make([]string, len(args))
	for i, arg := range args {
		quoted[i] = unitQuote(arg)
	}
	arguments := strings.Join(quoted, " ")
	if installing && previous != nil {
		// Preserve the saved invocation when -install updates the executable.
		_, line, found := strings.Cut(string(previous), "\nExecStart=")
		line, _, _ = strings.Cut(line, "\n")
		// 0.1.37 puts the executable first; newer units launch it through env.
		line = strings.TrimPrefix(line, unitQuote(":/usr/bin/env")+" ")
		binary, err := strconv.QuotedPrefix(line)
		if !found || err != nil {
			return false, fmt.Errorf("invalid ExecStart in %s", s.file)
		}
		arguments = strings.TrimSpace(line[len(binary):])
	}

	var unit bytes.Buffer
	fmt.Fprintf(&unit, "[Unit]\nDescription=Local AI Agent %s\n\n[Service]\n", kind)
	// ':' disables systemd's shell-style dollar expansion in executable arguments.
	// systemd rejects quotes in the executable name, but accepts them in argv.
	fmt.Fprintf(&unit, "ExecStart=%s %s %s\nRestart=on-failure\nRestartSec=2s\n", unitQuote(":/usr/bin/env"), unitQuote(executable), arguments)
	if strings.ContainsAny(dir, "\r\n") {
		return false, errors.New("systemd service directory contains a newline")
	}
	envFile := filepath.Join(dir, "systemd-"+kind+".env")
	if installing {
		if err := os.MkdirAll(filepath.Join(dir, "logs"), 0700); err != nil {
			return false, err
		}
		if err := writeServiceEnvironment(envFile, dir); err != nil {
			return false, err
		}
	}
	fmt.Fprintf(&unit, "EnvironmentFile=%s\n", strings.ReplaceAll(envFile, "%", "%%"))
	logName := "core.log"
	if kind == "gateway" {
		logName = "standalone.log"
	}
	// StandardOutput takes a single literal path, including embedded spaces.
	fmt.Fprintf(&unit, "StandardOutput=append:%s\nStandardError=inherit\n\n[Install]\nWantedBy=%s\n", strings.ReplaceAll(filepath.Join(dir, "logs", logName), "%", "%%"), s.target)
	if bytes.Equal(previous, unit.Bytes()) {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Join(dir, "logs"), 0700); err != nil {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(s.file), 0755); err != nil {
		return false, err
	}
	return true, writeUnitFile(s.file, unit.Bytes())
}

// systemd exposes Environment= through D-Bus. Keep the installation's paths,
// proxy URLs and Agent credentials in an owner-readable EnvironmentFile instead.
// A reinstall from a session that lacks one of these variables keeps the value saved
// earlier: after a boot the service has no shell to read it from again.
func writeServiceEnvironment(file, dir string) error {
	previous, err := os.ReadFile(file)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	saved := map[string]string{}
	for _, line := range strings.Split(string(previous), "\n") {
		if key, _, ok := strings.Cut(line, "="); ok {
			saved[key] = line
		}
	}
	var env bytes.Buffer
	put := func(key, value string) {
		escaped := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value)
		fmt.Fprintf(&env, "%s=\"%s\"\n", key, escaped)
	}
	for _, key := range []string{
		"HOME", "PATH", "XDG_CONFIG_HOME", "MINDFS_RELAY_BASE_URL", "MINDFS_STATIC_DIR", "MINDFS_AGENTS_CONFIG",
		"CODEX_HOME", "CLAUDE_CONFIG_DIR", "OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "GEMINI_API_KEY",
		"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
		"LOCAL_AI_AGENT_INSTALL_SCRIPT_BASE_URL", "LOCAL_AI_AGENT_DOWNLOAD_BASE_URL",
	} {
		if value, ok := os.LookupEnv(key); ok {
			put(key, value)
		} else if line, ok := saved[key]; ok {
			env.WriteString(line + "\n")
		}
	}
	put("IDE_AGENT_REMOTE_HOST_DIR", dir)
	put("IDE_AGENT_DATA_DIR", dir)
	return writeUnitFile(file, env.Bytes())
}

func writeUnitFile(path string, body []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".local-ai-agent-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, err = tmp.Write(body)
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), path)
}

func InstallLoginServices(dir, executable string) error {
	if _, err := os.Stat("/run/systemd/system"); errors.Is(err, os.ErrNotExist) {
		fmt.Fprintln(os.Stderr, "systemd is not running. The backend can run in the background; automatic startup is unavailable.")
		return nil
	} else if err != nil {
		return err
	}
	ctx := context.Background()
	if uid := os.Geteuid(); uid != 0 {
		// Lingering keeps this user's manager alive across logout and starts it at boot.
		user := strconv.Itoa(uid)
		lingerCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		out, err := exec.CommandContext(lingerCtx, "loginctl", "--no-ask-password", "enable-linger", user).CombinedOutput()
		cancel()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Could not enable boot before login (%v: %s). Ask an administrator to run: sudo loginctl enable-linger %s\n", err, strings.TrimSpace(string(out)), user)
		}
		if err := systemctl(ctx, "show", "--property=Version", "--value"); err != nil {
			// A minimal server can run systemd without providing user managers.
			// Preserve detached startup on a first install in that environment.
			for _, kind := range []string{"core", "gateway"} {
				s, pathErr := linuxServiceFor(dir, kind)
				if pathErr != nil {
					return pathErr
				}
				if _, e := os.Stat(s.file); !errors.Is(e, os.ErrNotExist) {
					return err
				}
			}
			fmt.Fprintf(os.Stderr, "User systemd manager unavailable (%v). Starting without automatic startup; enable the user manager and rerun the installer.\n", err)
			return nil
		}
	}
	var names []string
	for _, kind := range []string{"core", "gateway"} {
		s, err := linuxServiceFor(dir, kind)
		if err != nil {
			return err
		}
		args := []string{"--local-core"}
		if kind == "gateway" {
			args = []string{"-foreground", "-no-browser"}
		}
		if _, err = s.write(dir, kind, executable, args, true); err != nil {
			return err
		}
		names = append(names, s.name)
	}
	return systemctl(ctx, append([]string{"enable"}, names...)...)
}

func StartLoginService(ctx context.Context, dir, kind, executable string, args []string) (bool, error) {
	s, err := linuxServiceFor(dir, kind)
	if err != nil {
		return false, err
	}
	if _, err = os.Stat(s.file); errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return true, err
	}
	if args == nil {
		return true, systemctl(ctx, "start", s.name)
	}
	args, err = loginServiceArguments(dir, kind, args)
	if err != nil {
		return true, err
	}
	changed, err := s.write(dir, kind, executable, args, false)
	if err != nil {
		return true, err
	}
	if changed {
		if err := systemctl(ctx, "daemon-reload"); err != nil {
			return true, err
		}
	}
	return true, systemctl(ctx, "start", s.name)
}

func UnloadLoginService(ctx context.Context, dir, kind string) error {
	s, err := linuxServiceFor(dir, kind)
	if err != nil {
		return err
	}
	if _, err = os.Stat(s.file); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	err = systemctl(ctx, "stop", s.name)
	// systemctl stop returns 5 for an unloaded unit, including a rejected
	// 0.1.37 ExecStart. An upgrade can now replace that unit.
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 5 {
		return nil
	}
	return err
}

func RemoveLoginService(ctx context.Context, dir, kind string) error {
	s, err := linuxServiceFor(dir, kind)
	if err != nil {
		return err
	}
	if _, err = os.Stat(s.file); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err = systemctl(ctx, "disable", "--now", s.name); err != nil {
		return err
	}
	if err = os.Remove(s.file); err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(dir, "systemd-"+kind+".env")); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return systemctl(ctx, "daemon-reload")
}

func RemoveLoginServices(ctx context.Context, dir string) error {
	for _, kind := range []string{"gateway", "core"} {
		if err := RemoveLoginService(ctx, dir, kind); err != nil {
			return err
		}
	}
	return nil
}
