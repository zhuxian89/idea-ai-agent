package agent

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

// These tests read the registry that ships in the installer, not the testdata copy,
// so a regression in the built-in Antigravity entry cannot hide behind fixtures.
func loadShippedRegistry(t *testing.T) Config {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "agents.json")
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig(%s) failed: %v", path, err)
	}
	return cfg
}

func TestShippedRegistryDeclaresAntigravityOverACP(t *testing.T) {
	cfg := loadShippedRegistry(t)
	def, ok := cfg.GetAgent("antigravity")
	if !ok {
		t.Fatal("shipped agents.json must declare antigravity")
	}
	if def.Command != "agy" {
		t.Fatalf("command = %q, want agy", def.Command)
	}
	if def.Protocol != ProtocolACP {
		t.Fatalf("protocol = %q, want %q", def.Protocol, ProtocolACP)
	}
	if !reflect.DeepEqual(def.Args, []string{"acp"}) {
		t.Fatalf("args = %v, want [acp]", def.Args)
	}
	if !reflect.DeepEqual(def.VersionArgs, []string{"--version"}) {
		t.Fatalf("version args = %v, want [--version]", def.VersionArgs)
	}
	if len(def.InstallCommands) == 0 || len(def.UpdateCommands) == 0 {
		t.Fatalf("install/update commands must be declared: install=%v update=%v", def.InstallCommands, def.UpdateCommands)
	}
}

// The UI falls back to the first agent, so antigravity must stay out of slot one.
func TestShippedRegistryAppendsAntigravityAfterExistingAgents(t *testing.T) {
	cfg := loadShippedRegistry(t)
	if len(cfg.Agents) == 0 {
		t.Fatal("shipped registry has no agents")
	}
	if cfg.Agents[0].Name == "antigravity" {
		t.Fatal("antigravity must not become the first (default) agent")
	}
	if last := cfg.Agents[len(cfg.Agents)-1].Name; last != "antigravity" {
		t.Fatalf("antigravity should be appended last, got %q", last)
	}
}

func TestAntigravityAbsentIsReportedAsNotInstalled(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	cfg := loadShippedRegistry(t)
	def, _ := cfg.GetAgent("antigravity")
	status := probeInstallStatus("antigravity", def, time.Now().UTC())
	if status.Installed {
		t.Fatal("antigravity must not be reported installed when agy is missing from PATH")
	}
	if status.ProbeError == "" {
		t.Fatal("missing agy should surface a probe error")
	}
}

func TestAntigravityInstalledIsDetectedWithoutStartingIt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	bin := t.TempDir()
	calls := filepath.Join(bin, "calls.log")
	// The fixture records each invocation, so the test can prove install detection
	// only runs --version and never starts `agy acp`.
	script := "#!/bin/sh\necho \"$*\" >> \"" + calls + "\"\necho 1.5.8\n"
	if err := os.WriteFile(filepath.Join(bin, "agy"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	cfg := loadShippedRegistry(t)
	def, _ := cfg.GetAgent("antigravity")
	status := probeInstallStatus("antigravity", def, time.Now().UTC())
	if !status.Installed {
		t.Fatalf("expected agy on PATH to be detected: %+v", status)
	}
	if status.Available {
		t.Fatal("install detection alone must not mark antigravity available")
	}
	if status.Protocol != ProtocolACP {
		t.Fatalf("protocol = %q, want %q", status.Protocol, ProtocolACP)
	}
	if got := detectDefinitionVersion(def); got != "1.5.8" {
		t.Fatalf("version = %q, want 1.5.8", got)
	}
	logged, err := os.ReadFile(calls)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(logged), "--version") {
		t.Fatalf("expected the --version probe to run; invocations: %q", logged)
	}
	if strings.Contains(string(logged), "acp") {
		t.Fatalf("install detection must not start agy acp; invocations: %q", logged)
	}
}
