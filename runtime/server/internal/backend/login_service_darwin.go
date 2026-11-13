package backend

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type loginService struct {
	label, path, target string
}

func serviceFor(dir, kind string) (loginService, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return loginService{}, err
	}
	// Separate discovery directories must never control one another's jobs.
	id := sha256.Sum256([]byte(filepath.Clean(dir)))
	label := fmt.Sprintf("dev.ideaagent.%x.%s", id[:8], kind)
	return loginService{label, filepath.Join(home, "Library", "LaunchAgents", label+".plist"),
		fmt.Sprintf("gui/%d/%s", os.Getuid(), label)}, nil
}

func (s loginService) write(dir, executable string, args []string) error {
	var body bytes.Buffer
	body.WriteString(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>`)
	value := func(text string) {
		body.WriteString("<string>")
		xml.EscapeText(&body, []byte(text))
		body.WriteString("</string>")
	}
	body.WriteString("<key>Label</key>")
	value(s.label)
	body.WriteString("<key>ProgramArguments</key><array>")
	for _, arg := range append([]string{executable}, args...) {
		value(arg)
	}
	body.WriteString("</array><key>EnvironmentVariables</key><dict>")
	for _, key := range []string{"HOME", "PATH", "MINDFS_RELAY_BASE_URL", "MINDFS_STATIC_DIR", "CODEX_HOME", "CLAUDE_CONFIG_DIR"} {
		if text, ok := os.LookupEnv(key); ok {
			fmt.Fprintf(&body, "<key>%s</key>", key)
			value(text)
		}
	}
	body.WriteString("<key>IDE_AGENT_REMOTE_HOST_DIR</key>")
	value(dir)
	body.WriteString("</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>")
	logName := "core.log"
	if strings.HasSuffix(s.label, ".gateway") {
		logName = "standalone.log"
	}
	logPath := filepath.Join(dir, "logs", logName)
	for _, key := range []string{"StandardOutPath", "StandardErrorPath"} {
		fmt.Fprintf(&body, "<key>%s</key>", key)
		value(logPath)
	}
	body.WriteString("</dict></plist>\n")
	if err := os.MkdirAll(filepath.Dir(logPath), 0700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	return os.WriteFile(s.path, body.Bytes(), 0600)
}

// savedArguments returns the program arguments (without the executable) recorded in
// an existing job, so a reinstall keeps the options the user already started it with.
func (s loginService) savedArguments() ([]string, bool, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	// A launchd plist alternates <key> and value elements inside one <dict>.
	var plist struct {
		Dict struct {
			Items []struct {
				XMLName xml.Name
				Text    string   `xml:",chardata"`
				Strings []string `xml:"string"`
			} `xml:",any"`
		} `xml:"dict"`
	}
	if err := xml.Unmarshal(data, &plist); err != nil {
		return nil, false, fmt.Errorf("read %s: %w", s.path, err)
	}
	items := plist.Dict.Items
	for i := 0; i+1 < len(items); i++ {
		if items[i].XMLName.Local == "key" && items[i].Text == "ProgramArguments" {
			if arguments := items[i+1].Strings; len(arguments) > 1 {
				return arguments[1:], true, nil
			}
		}
	}
	return nil, false, nil
}

func InstallLoginServices(dir, executable string) error {
	for _, kind := range []string{"core", "gateway"} {
		s, err := serviceFor(dir, kind)
		if err != nil {
			return err
		}
		args := []string{"--local-core"}
		if kind == "gateway" {
			args = []string{"-foreground", "-no-browser"}
			// An upgrade runs -install again; keep the options already chosen for this job.
			if saved, found, err := s.savedArguments(); err != nil {
				return err
			} else if found {
				args = saved
			}
		}
		if err := s.write(dir, executable, args); err != nil {
			return err
		}
	}
	return nil
}

// StartLoginService reports whether this installation is managed by launchd.
// Non-installed development processes keep their existing detached lifecycle.
func StartLoginService(ctx context.Context, dir, kind, executable string, args []string) (bool, error) {
	s, err := serviceFor(dir, kind)
	if err != nil {
		return false, err
	}
	if _, err := os.Stat(s.path); errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return true, err
	}
	args, err = loginServiceArguments(dir, kind, args)
	if err != nil {
		return true, err
	}
	if err := s.write(dir, executable, args); err != nil {
		return true, err
	}
	if exec.CommandContext(ctx, "/bin/launchctl", "print", s.target).Run() != nil {
		return true, launchctl(ctx, "bootstrap", fmt.Sprintf("gui/%d", os.Getuid()), s.path)
	}
	return true, launchctl(ctx, "kickstart", s.target)
}

// Called after a normal service exit, so unloading cannot interrupt a chat.
func UnloadLoginService(ctx context.Context, dir, kind string) error {
	s, err := serviceFor(dir, kind)
	if err != nil {
		return err
	}
	if exec.CommandContext(ctx, "/bin/launchctl", "print", s.target).Run() != nil {
		return nil
	}
	return launchctl(ctx, "bootout", s.target)
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
	if err := UnloadLoginService(ctx, dir, kind); err != nil {
		return err
	}
	s, err := serviceFor(dir, kind)
	if err != nil {
		return err
	}
	if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func launchctl(ctx context.Context, args ...string) error {
	output, err := exec.CommandContext(ctx, "/bin/launchctl", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl %v: %w: %s", args, err, output)
	}
	return nil
}
