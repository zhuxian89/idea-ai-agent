//go:build darwin

package backend

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Reinstalling (an upgrade runs -install again) must not discard the startup
// arguments the user already chose for the managed remote entry.
func TestReinstallKeepsSavedGatewayArguments(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	dir := filepath.Join(home, "remote")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(home, "local-ai-agent")

	if err := InstallLoginServices(dir, executable); err != nil {
		t.Fatal(err)
	}
	gateway, err := serviceFor(dir, "gateway")
	if err != nil {
		t.Fatal(err)
	}
	// The user starts the service with their own settings; the managed job records them.
	custom := []string{"-foreground", "-no-browser", "-agent-config", "/etc/agents.json", "-no-relayer=true"}
	if err := gateway.write(dir, executable, custom); err != nil {
		t.Fatal(err)
	}

	if err := InstallLoginServices(dir, executable); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(gateway.path)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"-agent-config", "/etc/agents.json", "-no-relayer=true"} {
		if !strings.Contains(string(data), "<string>"+want+"</string>") {
			t.Fatalf("reinstall dropped saved argument %q:\n%s", want, data)
		}
	}
	core, err := serviceFor(dir, "core")
	if err != nil {
		t.Fatal(err)
	}
	coreData, err := os.ReadFile(core.path)
	if err != nil || !strings.Contains(string(coreData), "<string>--local-core</string>") {
		t.Fatalf("core job was not (re)written with its fixed arguments: %v", err)
	}
}
