package usecase

import (
	"mindfs/server/internal/agent"
	"testing"
)

func TestNativeDefaultsDoNotPinCachedModelOrEffort(t *testing.T) {
	for _, name := range []string{"codex", "claude"} {
		in := SendMessageInput{Agent: name}
		applyMessageRuntimeDefaultsFromStatus(&in, agent.Status{Name: name, DefaultModelID: "stale-sdk-model", CurrentModelID: "cached-model", DefaultEffort: "high", DefaultFastService: "on"}, true)
		if in.Model != "" || in.Effort != "" || in.FastService != "" {
			t.Fatalf("%s defaults override local CLI: model=%s effort=%s service=%s", name, in.Model, in.Effort, in.FastService)
		}
		in.Model, in.Effort = "explicit-model", "ultra"
		applyMessageRuntimeDefaultsFromStatus(&in, agent.Status{Name: name}, true)
		if in.Model != "explicit-model" || in.Effort != "ultra" {
			t.Fatal("explicit selection changed")
		}
	}
}
