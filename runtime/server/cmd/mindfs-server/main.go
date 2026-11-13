package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

var version = "dev"

func main() {
	if err := runCLI(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type startupConfig struct {
	Addr          *string `json:"addr"`
	NoRelayer     *bool   `json:"noRelayer"`
	NoRelayerFlag *bool   `json:"no-relayer"`
	WebPush       *bool   `json:"webPush"`
	WebPushFlag   *bool   `json:"web-push"`
	AgentConfig   *string `json:"agent-config"`
	NotifyScript  *string `json:"notify-script"`
}

func loadStartupConfig(path string) (startupConfig, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return startupConfig{}, nil
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return startupConfig{}, fmt.Errorf("read config %s: %w", path, err)
	}
	var cfg startupConfig
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return startupConfig{}, fmt.Errorf("decode config %s: %w", path, err)
	}
	return cfg, nil
}

func visitedFlags(flags *flag.FlagSet) map[string]bool {
	visited := make(map[string]bool)
	flags.Visit(func(f *flag.Flag) {
		visited[f.Name] = true
	})
	return visited
}

func applyStartupConfig(cfg startupConfig, explicit map[string]bool, addr *string, noRelayer *bool, webPush *bool, agentConfig *string, notifyScript *string) {
	if cfg.Addr != nil && !explicit["addr"] {
		*addr = strings.TrimSpace(*cfg.Addr)
	}
	if value := firstBool(cfg.NoRelayer, cfg.NoRelayerFlag); value != nil && !explicit["no-relayer"] {
		*noRelayer = *value
	}
	if value := firstBool(cfg.WebPush, cfg.WebPushFlag); value != nil && !explicit["web-push"] {
		*webPush = *value
	}
	if cfg.AgentConfig != nil && !explicit["agent-config"] {
		*agentConfig = strings.TrimSpace(*cfg.AgentConfig)
	}
	if cfg.NotifyScript != nil && !explicit["notify-script"] {
		*notifyScript = strings.TrimSpace(*cfg.NotifyScript)
	}
}

func firstBool(values ...*bool) *bool {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
