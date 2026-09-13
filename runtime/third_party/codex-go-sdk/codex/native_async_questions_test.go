package codex

import (
	"encoding/json"
	"testing"

	"github.com/fanwenlin/codex-go-sdk/types"
)

func TestNativeAsyncQuestionPreservesStructuredChoiceAndTurn(t *testing.T) {
	line, done, err := appEventToLegacyLine(appEvent{
		Method: "item/completed",
		Params: json.RawMessage(`{"threadId":"thread-a","turnId":"turn-a","item":{"type":"agentMessage","id":"choice-a","delivery":"async","text":"Choose","questions":[{"title":"Choose","options":["List","Tabs"]},{"title":"Details","options":null}]}}`),
	}, &turnState{items: make(map[string]map[string]interface{})})
	if err != nil || done {
		t.Fatalf("conversion = %q, %v, %v", line, done, err)
	}
	event, err := parseThreadEvent(line)
	if err != nil {
		t.Fatal(err)
	}
	completed, ok := event.(*types.ItemCompletedEvent)
	if !ok || completed.ThreadID != "thread-a" || completed.TurnID != "turn-a" {
		t.Fatalf("lost native identity: %#v", event)
	}
	message, ok := completed.Item.(*types.AgentMessageItem)
	if !ok || message.Delivery != "async" || len(message.Questions) != 2 {
		t.Fatalf("lost structured question: %#v", completed.Item)
	}
	if message.Questions[0].Options[1] != "Tabs" || message.Questions[1].Title != "Details" {
		t.Fatalf("lost choices/free text question: %#v", message.Questions)
	}
}
