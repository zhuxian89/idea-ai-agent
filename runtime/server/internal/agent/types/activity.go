package types

import (
	"encoding/json"
	"math"
	"strings"
)

// ActivityFactsV1 carries native presentation facts, never formatted UI copy
// or a second copy of command output. All existing ToolCall fields stay valid.
type ActivityFactsV1 struct {
	SchemaVersion int                   `json:"schemaVersion"`
	Agent         string                `json:"agent"`
	Origin        string                `json:"origin"`
	Operation     string                `json:"operation"`
	Source        string                `json:"source"`
	NativeTurnID  string                `json:"nativeTurnId,omitempty"`
	ParentCallID  string                `json:"parentCallId,omitempty"`
	Actions       *[]ActivityAction     `json:"actions,omitempty"`
	DisplayLabel  *ActivityDisplayLabel `json:"displayLabel,omitempty"`
	Tool          *ActivityTool         `json:"tool,omitempty"`
	Outcome       string                `json:"outcome,omitempty"`
	DurationMs    *float64              `json:"durationMs,omitempty"`
}

// A malformed optional envelope must not make its enclosing legacy ToolCall
// unreadable. Version zero is intentionally unsupported by the presentation
// reader, which falls back to the original title/status/detail fields.
func (facts *ActivityFactsV1) UnmarshalJSON(data []byte) error {
	type wireFacts ActivityFactsV1
	var decoded wireFacts
	if err := json.Unmarshal(data, &decoded); err != nil {
		*facts = ActivityFactsV1{}
		return nil
	}
	*facts = ActivityFactsV1(decoded)
	facts.DurationMs = NativeToolDuration(facts.DurationMs)
	return nil
}

type ActivityAction struct {
	Type  string `json:"type"`
	Name  string `json:"name,omitempty"`
	Path  string `json:"path,omitempty"`
	Query string `json:"query,omitempty"`
}

type ActivityDisplayLabel struct {
	Text   string `json:"text"`
	Source string `json:"source"`
}

type ActivityTool struct {
	Name        string `json:"name"`
	Server      string `json:"server,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
}

func NativeToolOutcome(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "complete", "success":
		return "completed"
	case "failed", "error":
		return "failed"
	case "declined", "denied":
		return "declined"
	case "cancelled", "canceled":
		return "cancelled"
	case "interrupted":
		return "interrupted"
	default:
		return ""
	}
}

func IsRunningToolStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "pending", "running", "in_progress", "inprogress":
		return true
	default:
		return false
	}
}

func MergeToolStatus(base, next string) string {
	if strings.TrimSpace(next) == "" || (NativeToolOutcome(base) != "" && IsRunningToolStatus(next)) {
		return base
	}
	return next
}

func NativeToolDuration(value *float64) *float64 {
	if value == nil || *value < 0 || math.IsNaN(*value) || math.IsInf(*value, 0) {
		return nil
	}
	copy := *value
	return &copy
}

func CloneActivityFacts(facts *ActivityFactsV1) *ActivityFactsV1 {
	if facts == nil {
		return nil
	}
	out := *facts
	if facts.Actions != nil {
		actions := append([]ActivityAction{}, (*facts.Actions)...)
		out.Actions = &actions
	}
	if facts.DisplayLabel != nil {
		label := *facts.DisplayLabel
		out.DisplayLabel = &label
	}
	if facts.Tool != nil {
		tool := *facts.Tool
		out.Tool = &tool
	}
	out.DurationMs = NativeToolDuration(facts.DurationMs)
	return &out
}

// Absent fields preserve earlier facts. An explicit empty actions array clears
// the previous projection, while a later native outcome may correct an earlier one.
func MergeActivityFacts(base, next *ActivityFactsV1) *ActivityFactsV1 {
	if base == nil {
		return CloneActivityFacts(next)
	}
	if next == nil {
		return CloneActivityFacts(base)
	}
	if base.SchemaVersion != 0 && next.SchemaVersion != 0 && next.SchemaVersion != base.SchemaVersion {
		return CloneActivityFacts(next)
	}
	out := CloneActivityFacts(base)
	if next.SchemaVersion != 0 {
		out.SchemaVersion = next.SchemaVersion
	}
	copyString := func(target *string, value string) {
		if value != "" {
			*target = value
		}
	}
	copyString(&out.Agent, next.Agent)
	copyString(&out.Origin, next.Origin)
	copyString(&out.Operation, next.Operation)
	copyString(&out.Source, next.Source)
	copyString(&out.NativeTurnID, next.NativeTurnID)
	copyString(&out.ParentCallID, next.ParentCallID)
	copyString(&out.Outcome, next.Outcome)
	if next.Actions != nil {
		actions := append([]ActivityAction{}, (*next.Actions)...)
		out.Actions = &actions
	}
	if next.DisplayLabel != nil {
		if out.DisplayLabel == nil {
			out.DisplayLabel = &ActivityDisplayLabel{}
		}
		copyString(&out.DisplayLabel.Text, next.DisplayLabel.Text)
		copyString(&out.DisplayLabel.Source, next.DisplayLabel.Source)
	}
	if next.Tool != nil {
		if out.Tool == nil {
			out.Tool = &ActivityTool{}
		}
		copyString(&out.Tool.Name, next.Tool.Name)
		copyString(&out.Tool.Server, next.Tool.Server)
		copyString(&out.Tool.DisplayName, next.Tool.DisplayName)
	}
	if duration := NativeToolDuration(next.DurationMs); duration != nil {
		out.DurationMs = duration
	}
	return out
}
