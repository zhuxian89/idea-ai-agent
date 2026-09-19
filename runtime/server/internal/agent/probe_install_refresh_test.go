package agent

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestRefreshInstallationsFindsNewCLIWithoutStartingIt(t *testing.T) {
	bin := t.TempDir()
	t.Setenv("PATH", bin)
	command := "idea-test-agent"
	filename := command
	if runtime.GOOS == "windows" {
		filename += ".exe"
		t.Setenv("PATHEXT", ".EXE")
	}
	prober := &Prober{
		cfg:      &Config{Agents: []Definition{{Name: "test-agent", Command: command}}},
		statuses: make(map[string]Status),
	}
	prober.RefreshInstallations()
	initial, ok := prober.GetStatus("test-agent")
	if !ok || initial.Installed {
		t.Fatal("missing executable must be reported as not installed")
	}
	// Invalid executable bytes deliberately prove refresh never runs the file.
	executable := filepath.Join(bin, filename)
	if err := os.WriteFile(executable, []byte("not an executable"), 0o700); err != nil {
		t.Fatal(err)
	}
	prober.RefreshInstallations()
	installed, _ := prober.GetStatus("test-agent")
	if !installed.Installed || installed.Available {
		t.Fatalf("expected detected CLI with runtime still unprobed: %+v", installed)
	}
	installed.Version = "test-version"
	installed.CurrentModelID = "native-model"
	installed.RuntimeError = "login required"
	prober.setStatus(installed)
	prober.RefreshInstallations()
	retained, _ := prober.GetStatus("test-agent")
	if retained.Version != "test-version" || retained.CurrentModelID != "native-model" ||
		retained.RuntimeError != "login required" || !retained.LastProbe.Equal(installed.LastProbe) {
		t.Fatalf("refresh must retain native runtime results when presence is unchanged: %+v", retained)
	}
	if err := os.Remove(executable); err != nil {
		t.Fatal(err)
	}
	prober.RefreshInstallations()
	removed, _ := prober.GetStatus("test-agent")
	if removed.Installed {
		t.Fatal("removed executable must no longer be reported as installed")
	}
}

func TestRefreshInstallationsRefreshesKnownVersion(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	bin := t.TempDir()
	command := "versioned-test-agent"
	executable := filepath.Join(bin, command)
	writeVersion := func(version string) {
		t.Helper()
		if err := os.WriteFile(executable, []byte("#!/bin/sh\necho "+version+"\n"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	writeVersion("1.0.0")
	t.Setenv("PATH", bin)
	prober := &Prober{
		cfg: &Config{Agents: []Definition{{
			Name:        "test-agent",
			Command:     command,
			VersionArgs: []string{"--version"},
		}}},
		statuses: make(map[string]Status),
	}
	prober.RefreshInstallations()
	initial, _ := prober.GetStatus("test-agent")
	if initial.Version != "1.0.0" {
		t.Fatalf("initial version = %q", initial.Version)
	}

	writeVersion("1.1.0")
	prober.RefreshInstallations()
	updated, _ := prober.GetStatus("test-agent")
	if updated.Version != "1.1.0" {
		t.Fatalf("updated version = %q", updated.Version)
	}
}
