package collab

import (
	"strings"
	"testing"
)

func TestControlStreamFilterTokenByTokenAndChunkSplits(t *testing.T) {
	full := strings.Join([]string{
		"# 审核结论",
		"",
		"普通代码围栏保持原样：",
		"```go",
		"fmt.Println(\"hello\")",
		"```",
		"",
		"嵌套四反引号里的示例也不误吞：",
		"````markdown",
		"```mindfs-control",
		`{"kind":"example-inside-markdown"}`,
		"```",
		"````",
		"",
		"```mindfs-control",
		`{"kind":"review","items":[{"item_id":"R1","title":"空指针检查"}]}`,
		"```",
		"",
		"尾部说明。",
	}, "\n")

	wantVisible := strings.Join([]string{
		"# 审核结论",
		"",
		"普通代码围栏保持原样：",
		"```go",
		"fmt.Println(\"hello\")",
		"```",
		"",
		"嵌套四反引号里的示例也不误吞：",
		"````markdown",
		"```mindfs-control",
		`{"kind":"example-inside-markdown"}`,
		"```",
		"````",
		"",
		"",
		"尾部说明。",
	}, "\n")

	for _, step := range []int{1, 2, 5, 13, len(full)} {
		f := NewControlStreamFilter()
		var streamed strings.Builder
		for i := 0; i < len(full); i += step {
			end := i + step
			if end > len(full) {
				end = len(full)
			}
			streamed.WriteString(f.Push(full[i:end]))
		}
		streamed.WriteString(f.Flush())
		if streamed.String() != wantVisible {
			t.Fatalf("step=%d visible mismatch:\ngot:\n%s\nwant:\n%s", step, streamed.String(), wantVisible)
		}
		blocks := f.Blocks()
		if len(blocks) != 1 || blocks[0].Err != nil || blocks[0].Unclosed {
			t.Fatalf("step=%d blocks = %#v, want 1 valid block", step, blocks)
		}
		if !strings.Contains(string(blocks[0].Payload), `"item_id":"R1"`) {
			t.Fatalf("step=%d payload = %s", step, string(blocks[0].Payload))
		}
	}

	// Verify normal non-fence line streams immediately without waiting for '\n'.
	f := NewControlStreamFilter()
	if got := f.Push("Hello"); got != "Hello" {
		t.Fatalf("Push(Hello) = %q, want immediate token output", got)
	}
}

func TestControlStreamFilterHidesMalformedAndUnclosedBlocks(t *testing.T) {
	malformed := "正文\r\n  ```mindfs-control\r\n{bad json\r\n  ```\r\n后文"
	f1 := NewControlStreamFilter()
	got1 := f1.Push(malformed) + f1.Flush()
	if strings.Contains(got1, "bad json") || strings.Contains(got1, "mindfs-control") {
		t.Fatalf("malformed control block leaked into visible text: %q", got1)
	}
	if len(f1.Blocks()) != 1 || f1.Blocks()[0].Err == nil {
		t.Fatalf("expected parse error on malformed block, got %#v", f1.Blocks())
	}

	unclosed := "正文\n```mindfs-control\n{\"partial\":123"
	f2 := NewControlStreamFilter()
	got2 := f2.Push(unclosed) + f2.Flush()
	if got2 != "正文\n" {
		t.Fatalf("unclosed control block leaked into visible text: %q", got2)
	}
	if len(f2.Blocks()) != 1 || !f2.Blocks()[0].Unclosed || f2.Blocks()[0].Err == nil {
		t.Fatalf("expected unclosed error block, got %#v", f2.Blocks())
	}
}

func TestControlStreamFilterCompletionSuffixKeepsVisibleTextClean(t *testing.T) {
	docPath := ".mindfs/runs/run-1/01-初次实现说明.md"
	wantNotice := "阶段交付路径：" + docPath

	cases := []struct {
		name       string
		input      string
		wantSuffix string
	}{
		{
			name:       "no trailing newline",
			input:      "# 实现说明\n\n已完成。",
			wantSuffix: "\n\n" + wantNotice,
		},
		{
			name:       "single trailing newline",
			input:      "# 实现说明\n已完成。\n",
			wantSuffix: "\n" + wantNotice,
		},
		{
			name:       "double trailing newline before stripped control block",
			input:      "# 审核意见\n\n```mindfs-control\n{\"kind\":\"review\",\"items\":[]}\n```\n",
			wantSuffix: wantNotice,
		},
		{
			name:       "empty visible text skips notice",
			input:      "```mindfs-control\n{\"kind\":\"review\",\"items\":[]}\n```\n",
			wantSuffix: "",
		},
		{
			name:       "already contains notice skips duplicate",
			input:      "实现完成。\n\n" + wantNotice,
			wantSuffix: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := NewControlStreamFilterWithDeliveryPath(docPath)
			got := f.Push(tc.input) + f.Flush()
			if got != f.VisibleText() {
				t.Fatalf("streamed %q != VisibleText %q", got, f.VisibleText())
			}
			if suffix := f.CompletionSuffix(); suffix != tc.wantSuffix {
				t.Fatalf("CompletionSuffix() = %q, want %q", suffix, tc.wantSuffix)
			}
			if tc.name != "already contains notice skips duplicate" && strings.Contains(f.VisibleText(), wantNotice) {
				t.Fatalf("VisibleText() must not contain delivery footer: %q", f.VisibleText())
			}
		})
	}
}

func TestControlStreamFilterToolBoundariesAndReviewBlockGate(t *testing.T) {
	f := NewControlStreamFilterWithDeliveryPath(".mindfs/runs/run-1/第01轮/02-审核意见.md").RequireValidReviewBlock(1, nil)

	// Pre-tool waiting chatter stays in VisibleText() for chat, excluded from DeliverableText().
	f.Push("正在执行检查，等待子任务完成。\n\n")
	f.MarkToolActivity()
	f.Push("仍在运行只读检索...\n")
	f.MarkToolActivity()
	f.Push("\n\n# 第01轮 审核意见\n\n## R1 · 问题说明\n具体内容。\n")
	// Trailing tool call (e.g. update_steps) followed only by control block must NOT wipe DeliverableText().
	f.MarkToolActivity()
	f.Push("\n```mindfs-control\n{\"kind\":\"review\",\"summary\":\"1处问题\",\"items\":[{\"item_id\":\"R1\",\"title\":\"问题\"}]}\n```\n")
	f.Flush()

	if !strings.Contains(f.VisibleText(), "正在执行检查") || !strings.Contains(f.VisibleText(), "# 第01轮 审核意见") {
		t.Fatalf("VisibleText should retain full chat stream, got %q", f.VisibleText())
	}
	if strings.Contains(f.DeliverableText(), "正在执行检查") || strings.Contains(f.DeliverableText(), "仍在运行") {
		t.Fatalf("DeliverableText leaked pre-tool chatter: %q", f.DeliverableText())
	}
	if !strings.HasPrefix(f.DeliverableText(), "# 第01轮 审核意见") {
		t.Fatalf("DeliverableText = %q, want clean final report", f.DeliverableText())
	}
	if !strings.Contains(f.CompletionSuffix(), "阶段交付路径：") {
		t.Fatalf("valid review block should emit CompletionSuffix, got %q", f.CompletionSuffix())
	}

	// Incomplete review turn without valid review block must NOT claim delivery path.
	fIncomplete := NewControlStreamFilterWithDeliveryPath(".mindfs/runs/run-1/第01轮/02-审核意见.md").RequireValidReviewBlock(1, nil)
	fIncomplete.Push("两个只读子任务在后台运行，等它们返回后整理审核意见。")
	fIncomplete.Flush()
	if got := fIncomplete.CompletionSuffix(); got != "" {
		t.Fatalf("incomplete review turn must not emit delivery notice, got %q", got)
	}
}

func TestReReviewDeliverySuffixRequiresEveryPreviousItem(t *testing.T) {
	step := &StepCard{PreviousItems: []string{"R1", "R2"}, HighestItemID: 2}
	for _, tc := range []struct {
		name, resolved string
		wantDelivery   bool
	}{
		{name: "omitted item", resolved: `["R1"]`},
		{name: "all items accounted for", resolved: `["R1","R2"]`, wantDelivery: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := NewControlStreamFilterWithDeliveryPath(".mindfs/runs/run-1/第02轮/02-审核意见.md").RequireValidReviewBlock(2, step)
			f.Push("# 复核意见\n\n```mindfs-control\n" + `{"kind":"review","items":[],"resolved":` + tc.resolved + "}\n```\n")
			f.Flush()
			if got := f.CompletionSuffix(); (got != "") != tc.wantDelivery {
				t.Fatalf("delivery suffix = %q, want delivery %t", got, tc.wantDelivery)
			}
		})
	}
}
