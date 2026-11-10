package usecase

import (
	"fmt"
	"mindfs/server/internal/agent"
	"strings"
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

func TestResumeFallbackNoticeReportsHowManyMessagesAreRebuilt(t *testing.T) {
	for total, want := range map[int]int{0: 0, 7: 7, 20: 20, 500: switchContextTailLines} {
		got := resumeFallbackNotice(total)
		if !strings.Contains(got, fmt.Sprintf("最近 %d 条消息", want)) {
			t.Fatalf("total=%d notice=%q, want %d messages", total, got, want)
		}
	}
}
