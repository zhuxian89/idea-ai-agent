package types

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// NativeInteraction keeps protocol actions separate from display labels. Answers
// use the existing acknowledged question endpoint; schema errors remain retryable.
type NativeInteraction struct {
	Kind      string         `json:"kind"`
	Title     string         `json:"title"`
	Message   string         `json:"message"`
	URL       string         `json:"url,omitempty"`
	Schema    map[string]any `json:"schema,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
	Actions   []string       `json:"actions"`
	schema    *jsonschema.Schema
	schemaErr error
}

type noExternalSchema struct{}

func (noExternalSchema) Load(url string) (any, error) {
	return nil, fmt.Errorf("external schema references are unsupported: %s", url)
}

func NewElicitation(server, message, mode, url string, schema map[string]any) (*NativeInteraction, error) {
	if mode == "" {
		mode = "form"
	}
	if mode != "form" && mode != "openai/form" && mode != "url" {
		return nil, fmt.Errorf("unsupported elicitation mode: %s", mode)
	}
	n := &NativeInteraction{Kind: mode, Title: server + " · MCP", Message: message, URL: url, Schema: schema, Actions: []string{"accept", "decline", "cancel"}}
	if mode != "url" {
		c := jsonschema.NewCompiler()
		c.UseLoader(noExternalSchema{})
		c.AssertFormat()
		if schema == nil {
			n.schemaErr = errors.New("missing requested schema")
		} else {
			n.schemaErr = c.AddResource("https://native.invalid/form", schema)
			if n.schemaErr == nil {
				n.schema, n.schemaErr = c.Compile("https://native.invalid/form")
			}
		}
	}
	return n, nil
}

func (n *NativeInteraction) Validate(answers map[string]string) error {
	_, err := n.Result(answers)
	return err
}

func (n *NativeInteraction) Result(answers map[string]string) (map[string]any, error) {
	action := strings.TrimSpace(answers["q_0"])
	valid := false
	for _, a := range n.Actions {
		if action == a {
			valid = true
		}
	}
	if !valid {
		return nil, errors.New("choose an explicit native action")
	}
	switch n.Kind {
	case "permissions":
		permissions := map[string]any{}
		scope := "turn"
		if action == "allow_turn" || action == "allow_session" {
			// Never accept permission data from the browser: grant exactly the requested set.
			permissions, _ = n.Details["permissions"].(map[string]any)
			if permissions == nil {
				return nil, errors.New("missing requested permissions")
			}
			if action == "allow_session" {
				scope = "session"
			}
		}
		return map[string]any{"permissions": permissions, "scope": scope}, nil
	case "refusal_fallback_prompt":
		if action == "cancelled" {
			return map[string]any{"behavior": "cancelled"}, nil
		}
		return map[string]any{"behavior": "completed", "result": action}, nil
	default:
		var content map[string]any
		if action == "accept" && n.Kind != "url" {
			if n.schemaErr != nil {
				return nil, fmt.Errorf("invalid requested schema: %w", n.schemaErr)
			}
			if err := json.Unmarshal([]byte(answers["q_1"]), &content); err != nil || content == nil {
				return nil, errors.New("form content must be a JSON object")
			}
			if n.schema == nil {
				return nil, errors.New("missing requested schema")
			}
			if err := n.schema.Validate(content); err != nil {
				return nil, fmt.Errorf("form validation: %w", err)
			}
		}
		return map[string]any{"action": action, "content": content}, nil
	}
}

func (n *NativeInteraction) ToolCall(id string) ToolCall {
	options := make([]AskUserQuestionOption, 0, len(n.Actions))
	for _, a := range n.Actions {
		options = append(options, AskUserQuestionOption{Label: a})
	}
	return ToolCall{CallID: id, Title: n.Title, Status: "running", Kind: ToolKindAskUser, RawType: "native_interaction", Meta: map[string]any{
		"toolUseId": id, "nativeInteraction": n, "questions": []AskUserQuestionItem{{Question: n.Title, Options: options}},
	}}
}
