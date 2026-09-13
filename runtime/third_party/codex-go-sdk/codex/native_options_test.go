package codex

import "testing"

func TestNativeEffortIsNeverDowngraded(t *testing.T) {
	for _, model := range []string{"", "gpt-5.6", "gpt-5.5", "future-model", "custom-provider/model"} {
		for _, effort := range []string{"max", "ultra", "new-effort"} {
			params, err := (&AppServerExec{}).buildTurnParams("thread", CodexExecArgs{Model: model, ModelReasoningEffort: effort})
			if err != nil {
				t.Fatal(err)
			}
			if params["effort"] != effort {
				t.Errorf("model %q: effort = %v, want %s", model, params["effort"], effort)
			}
			for _, key := range []string{"approvalPolicy", "sandboxPolicy", "developerInstructions"} {
				if _, exists := params[key]; exists {
					t.Errorf("unexpected native override %s", key)
				}
			}
		}
	}
}
