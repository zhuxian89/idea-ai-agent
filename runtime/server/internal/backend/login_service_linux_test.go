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
	second := filepath.Join(dir, "install with spaces")
	if _, err := service.write(dir, "gateway", second, []string{"-foreground"}, true); err != nil {
		t.Fatal(err)
	}
	unit, err := os.ReadFile(service.file)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{unitQuote(":" + second), unitQuote(options[2]), "Restart=on-failure", "WantedBy=default.target"} {
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
