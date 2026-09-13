package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestIDETokenNotInherited(t *testing.T) {
	if os.Getenv("IDE_AGENT_TOKEN_CHILD_TEST") == "1" {
		_, present := os.LookupEnv("IDE_AGENT_TOKEN")
		fmt.Print(present)
		os.Exit(0)
	}
	const secret = "private-host-credential"
	t.Setenv("IDE_AGENT_TOKEN", secret)
	token, err := takeAccessToken()
	if err != nil || token != secret {
		t.Fatal("host credential was not retained")
	}
	child := exec.Command(os.Args[0], "-test.run=^TestIDETokenNotInherited$")
	child.Env = append(os.Environ(), "IDE_AGENT_TOKEN_CHILD_TEST=1")
	output, err := child.CombinedOutput()
	if err != nil || strings.TrimSpace(string(output)) != "false" {
		t.Fatalf("child inherited IDE credential, or probe failed: %v", err)
	}
}
