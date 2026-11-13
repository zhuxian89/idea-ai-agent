package remotehost

import (
	"fmt"
	"os"
	"path/filepath"
)

// AcquireStandalone prevents a standalone service and the legacy forwarding
// host from publishing competing descriptors or using the same Relay identity.
func AcquireStandalone(dir string) (*os.File, error) {
	if err := privateDir(dir); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(dir, "host.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	ok, err := tryLock(file)
	if err != nil || !ok {
		file.Close()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("the remote service is already running; stop it before starting the standalone backend")
	}
	return file, nil
}
