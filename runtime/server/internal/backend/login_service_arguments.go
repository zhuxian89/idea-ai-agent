package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Each managed launch reads the saved bound address. Keeping '-addr ...:0'
// in a startup job would change the port after every crash.
func loginServiceArguments(dir, kind string, args []string) ([]string, error) {
	if kind == "gateway" {
		for i := 0; i+1 < len(args); i++ {
			if args[i] != "-addr" {
				continue
			}
			data, _ := json.Marshal(map[string]string{"address": args[i+1]})
			if err := os.WriteFile(filepath.Join(dir, "gateway-address.json"), data, 0600); err != nil {
				return nil, err
			}
			return append(append([]string{}, args[:i]...), args[i+2:]...), nil
		}
	}
	return args, nil
}
