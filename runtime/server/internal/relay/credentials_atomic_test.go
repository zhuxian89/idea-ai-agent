package relay

import (
	"errors"
	"os"
	"testing"
)

func newTestCredentialsStore(t *testing.T) *CredentialsStore {
	t.Helper()
	configRoot := t.TempDir()
	t.Setenv("IDE_AGENT_DATA_DIR", "")
	t.Setenv("XDG_CONFIG_HOME", configRoot)
	t.Setenv("HOME", configRoot)
	store, err := NewCredentialsStore()
	if err != nil {
		t.Fatalf("NewCredentialsStore() error = %v", err)
	}
	return store
}

func TestCredentialsStoreReadsExistingFileAndOverwritesIt(t *testing.T) {
	store := newTestCredentialsStore(t)
	// File as written by earlier versions, which wrote the path in place.
	legacy := `{"relay":{"device_token":"dev_old","node_id":"node_old","node_name":"Old Mac","endpoint":"wss://relay.example.com/ws/connector"}}`
	if err := os.WriteFile(store.filePath, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load()
	if err != nil || got.Relay.DeviceToken != "dev_old" || got.Relay.NodeName != "Old Mac" {
		t.Fatalf("Load() = %+v, %v", got, err)
	}

	for i := 0; i < 2; i++ { // saving again over an existing file must keep working
		if err := store.Save(Credentials{Relay: RelayCredentials{DeviceToken: "dev_new", NodeID: "node_new", Endpoint: "wss://relay.example.com/ws/connector"}}); err != nil {
			t.Fatalf("Save() #%d error = %v", i, err)
		}
	}
	got, err = store.Load()
	if err != nil || got.Relay.DeviceToken != "dev_new" {
		t.Fatalf("Load() after Save = %+v, %v", got, err)
	}
	if _, err := os.Stat(store.filePath + ".tmp"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary file must not remain after Save, stat err = %v", err)
	}
}

func TestCredentialsStoreSaveTokenStationKeepsRelayFields(t *testing.T) {
	store := newTestCredentialsStore(t)
	relay := RelayCredentials{DeviceToken: "dev_1", NodeID: "node_1", NodeName: "Mac", Endpoint: "wss://relay.example.com/ws/connector"}
	if err := store.Save(Credentials{Relay: relay}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveTokenStation("station-token"); err != nil {
		t.Fatalf("SaveTokenStation() error = %v", err)
	}
	got, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Relay != relay || got.TokenStation.Token != "station-token" {
		t.Fatalf("Load() = %+v", got)
	}
}
