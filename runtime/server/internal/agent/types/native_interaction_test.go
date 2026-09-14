package types

import (
	"reflect"
	"testing"
)

func TestNativeFormValidationAndTypedContent(t *testing.T) {
	schema := map[string]any{"type": "object", "required": []any{"count", "enabled"}, "additionalProperties": false, "properties": map[string]any{"count": map[string]any{"type": "integer", "minimum": float64(1)}, "enabled": map[string]any{"type": "boolean"}}}
	n, err := NewElicitation("server", "Enter values", "form", "", schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{`{}`, `{"count":0,"enabled":true}`, `{"count":"2","enabled":true}`, `{"count":2,"enabled":true,"extra":1}`, `null`, `[]`, `{`} {
		if err := n.Validate(map[string]string{"q_0": "accept", "q_1": raw}); err == nil {
			t.Fatalf("accepted invalid content: %s", raw)
		}
	}
	got, err := n.Result(map[string]string{"q_0": "accept", "q_1": `{"count":2,"enabled":false}`})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got["content"], map[string]any{"count": float64(2), "enabled": false}) {
		t.Fatalf("types lost: %#v", got)
	}
	for _, action := range []string{"decline", "cancel"} {
		if err := n.Validate(map[string]string{"q_0": action}); err != nil {
			t.Fatal(err)
		}
	}
	if n.Validate(map[string]string{"q_0": "anything"}) == nil {
		t.Fatal("accepted arbitrary action")
	}
}

func TestNativeSchemaReferencesCannotReadFilesOrNetwork(t *testing.T) {
	for _, ref := range []string{"file:///etc/passwd", "http://localhost:12345/schema"} {
		n, err := NewElicitation("server", "", "form", "", map[string]any{"$ref": ref})
		if err != nil {
			t.Fatal(err)
		}
		if n.Validate(map[string]string{"q_0": "accept", "q_1": "{}"}) == nil {
			t.Fatal("external schema accepted")
		}
		if err := n.Validate(map[string]string{"q_0": "decline"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNativePermissionsUseOnlyRequestedScope(t *testing.T) {
	requested := map[string]any{"network": map[string]any{"enabled": true}}
	n := &NativeInteraction{Kind: "permissions", Details: map[string]any{"permissions": requested}, Actions: []string{"allow_turn", "allow_session", "decline"}}
	for _, action := range n.Actions {
		result, err := n.Result(map[string]string{"q_0": action, "q_1": `{"permissions":{"filesystem":{"write":["/"]}},"scope":"session"}`})
		if err != nil {
			t.Fatal(err)
		}
		want := requested
		if action == "decline" {
			want = map[string]any{}
		}
		if !reflect.DeepEqual(result["permissions"], want) {
			t.Fatalf("overgrant: %#v", result)
		}
		scope := "turn"
		if action == "allow_session" {
			scope = "session"
		}
		if result["scope"] != scope {
			t.Fatalf("scope: %#v", result)
		}
	}
}

func TestNativeURLAndDialogActions(t *testing.T) {
	n, err := NewElicitation("server", "Confirm", "url", "https://example.com", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range n.Actions {
		if err := n.Validate(map[string]string{"q_0": action}); err != nil {
			t.Fatal(err)
		}
	}
	n = &NativeInteraction{Kind: "refusal_fallback_prompt", Actions: []string{"retry_fallback", "edit_prompt", "cancelled"}}
	for _, action := range n.Actions {
		result, err := n.Result(map[string]string{"q_0": action})
		if err != nil {
			t.Fatal(err)
		}
		if action == "cancelled" {
			if result["behavior"] != "cancelled" || result["result"] != nil {
				t.Fatal(result)
			}
		} else if result["behavior"] != "completed" || result["result"] != action {
			t.Fatal(result)
		}
	}
}
