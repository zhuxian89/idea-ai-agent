package api

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestCCSwitchLocationsAndEmptyLaunch(t *testing.T) {
	mac := ccSwitchCandidates("darwin", "/fixture-user", "", "")
	if len(mac) != 2 || mac[0] != "/Applications/CC Switch.app" || !strings.Contains(mac[1], "Applications") {
		t.Fatalf("mac paths=%v", mac)
	}
	win := ccSwitchCandidates("windows", "user", "local", "program")
	if len(win) != 6 {
		t.Fatalf("Windows paths=%v", win)
	}
	for _, p := range win {
		if !strings.HasSuffix(p, "cc-switch.exe") {
			t.Fatal(p)
		}
	}
	if err := launchCCSwitch(context.Background(), ""); err == nil {
		t.Fatal("empty launch accepted")
	}
}

func TestInstalledCCSwitchDetection(t *testing.T) {
	if os.Getenv("CC_SWITCH_DETECTION_TEST") != "1" {
		t.Skip("opt-in installed application detection")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	path, err := findCCSwitch(ctx)
	if err != nil || path == "" {
		t.Fatalf("installed CC Switch not found: %q %v", path, err)
	}
	t.Logf("detected existing application: %s", path)
}
