package backend

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLinuxServiceReinstall(t *testing.T) {
	dir := t.TempDir()
	service := linuxService{name: "gateway.service", file: filepath.Join(dir, "units", "gateway.service"), target: "default.target"}
	t.Setenv("OPENAI_API_KEY", `test-"key\$%`)
	first := filepath.Join(dir, "first")
	if _, err := service.write(dir, "gateway", first, []string{"-foreground"}, true); err != nil {
		t.Fatal(err)
	}
	options := []string{"-foreground", "-agent-config", filepath.Join(dir, `$50% "agent".json`)}
	if _, err := service.write(dir, "gateway", first, options, false); err != nil {
		t.Fatal(err)
	}
	second := filepath.Join(dir, "user's install")
	if _, err := service.write(dir, "gateway", second, []string{"-foreground"}, true); err != nil {
		t.Fatal(err)
	}
	unit, err := os.ReadFile(service.file)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{unitQuote(":/usr/bin/env") + " " + unitQuote(second), unitQuote(options[2]), "Restart=on-failure", "WantedBy=default.target"} {
		if !bytes.Contains(unit, []byte(want)) {
			t.Fatalf("missing %q in unit", want)
		}
	}
	if strings.Contains(string(unit), "OPENAI_API_KEY") {
		t.Fatal("unit exposes credentials")
	}
	envFile := filepath.Join(dir, "systemd-gateway.env")
	info, err := os.Stat(envFile)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private environment file: %v %v", info, err)
	}
	env, err := os.ReadFile(envFile)
	if err != nil || !bytes.Contains(env, []byte(`OPENAI_API_KEY="test-\"key\\$%"`)) {
		t.Fatal("credential did not round trip into the environment file")
	}
}

// A reinstall from a session that lacks the proxy or credentials must not strip what
// the previous install saved: the service has no shell to get them from after a boot.
func TestLinuxServiceReinstallKeepsSavedEnvironment(t *testing.T) {
	dir := t.TempDir()
	service := linuxService{name: "gateway.service", file: filepath.Join(dir, "units", "gateway.service"), target: "default.target"}
	t.Setenv("HTTPS_PROXY", "http://proxy.example:3128")
	t.Setenv("OPENAI_API_KEY", `old-"key`)
	t.Setenv("PATH", "/old/bin")
	if _, err := service.write(dir, "gateway", filepath.Join(dir, "agent"), []string{"-foreground"}, true); err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{"HTTPS_PROXY", "OPENAI_API_KEY"} {
		if err := os.Unsetenv(key); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", "/new/bin")
	if _, err := service.write(dir, "gateway", filepath.Join(dir, "agent"), []string{"-foreground"}, true); err != nil {
		t.Fatal(err)
	}
	env, err := os.ReadFile(filepath.Join(dir, "systemd-gateway.env"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`HTTPS_PROXY="http://proxy.example:3128"`, `OPENAI_API_KEY="old-\"key"`, `PATH="/new/bin"`} {
		if !bytes.Contains(env, []byte(want)) {
			t.Fatalf("missing %q in environment file:\n%s", want, env)
		}
	}
	if bytes.Contains(env, []byte("/old/bin")) {
		t.Fatalf("variables present at install time must replace saved values:\n%s", env)
	}
}

// The installation record no longer creates the data directory before registration.
func TestLinuxServiceFirstInstallCreatesDataDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "remote")
	service := linuxService{name: "core.service", file: filepath.Join(t.TempDir(), "units", "core.service"), target: "default.target"}
	if _, err := service.write(dir, "core", filepath.Join(dir, "agent"), []string{"--local-core"}, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "systemd-core.env")); err != nil {
		t.Fatal(err)
	}
}
