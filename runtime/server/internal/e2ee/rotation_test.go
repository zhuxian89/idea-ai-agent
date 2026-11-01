package e2ee

import "testing"

func TestProjectMigrationRevokesLegacySessionsAndInflightHandshake(t *testing.T) {
	m := NewManager(Config{Enabled: true, NodeID: "old", PairingSecret: "old-secret"})
	key := DerivedKey{Transport: []byte("0123456789abcdef0123456789abcdef")}
	if _, err := m.OpenSessionForNode("browser", key, "old"); err != nil {
		t.Fatal(err)
	}
	m.ReplaceConfig(Config{Enabled: true, NodeID: "new", PairingSecret: "new-secret"})
	if _, err := m.SessionForClient("browser"); err == nil {
		t.Fatal("old session survived migration")
	}
	if _, err := m.OpenSessionForNode("late-old-browser", key, "old"); err == nil {
		t.Fatal("old in-flight handshake entered new identity")
	}
	if _, err := m.OpenSessionForNode("new-browser", key, "new"); err != nil {
		t.Fatal(err)
	}
}
