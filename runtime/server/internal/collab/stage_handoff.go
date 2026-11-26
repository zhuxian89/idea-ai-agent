package collab

import (
	"context"
	"fmt"
	"path"
	"strings"
)

func (s *Service) handoffTurn(ctx context.Context, root string, run Run, step *StepCard, file, instructions string) (StageTurnResult, error) {
	inputPath, err := WriteRunDoc(root, run.ID, file, instructions)
	if err != nil {
		return StageTurnResult{}, err
	}
	output := NewControlStreamFilterWithDeliveryPath(step.DocPath)
	if step.Key == StepReview {
		output.RequireValidReviewBlock(run.Round, step)
	}
	var permissionMode string
	if !step.ReadOnly {
		for _, member := range run.Snapshot.Members {
			if member.SlotID == step.SlotID {
				permissionMode = member.PermissionMode
				break
			}
		}
	}
	prompt := fmt.Sprintf("请读取项目文件 `%s`，按其中的要求完成%s。", inputPath, step.Title)
	result, err := s.runner.RunStageTurn(ctx, StageTurnRequest{RootID: run.RootID, SessionKey: step.SessionKey,
		Agent: step.Agent, Model: step.Model, Effort: step.Effort, PermissionMode: permissionMode, ReadOnly: step.ReadOnly, Prompt: prompt, StreamFilter: output})
	result.VisibleText = output.VisibleText()
	result.DeliverableText = output.DeliverableText()
	result.Blocks = output.Blocks()
	return result, err
}

func implementationInstructions(run Run) string {
	return "# 作者任务\n\n" + run.TaskPrompt + "\n\n## 实现交付\n完成任务并自测。按需打开任务中的附件路径。结合作者的补充要求，输出实现说明（目标、实际文件、实现、自测），后台写入 " + run.doc(DocImpl) + "。"
}

func reviewInstructions(run Run, standards string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# 只读审核\n\n所有路径相对于项目根目录。读取 %s 和 %s。按本轮清单 %s 检查实际代码，结合任务检查漏做的部分。需要比较时只查相关文件的局部差异。\n\n",
		DocRelPath(run.ID, taskFile), DocRelPath(run.ID, run.doc(DocImpl)), DocRelPath(run.ID, run.doc(changeListFile)))
	reviewStep := findStep(&run, StepReview)
	nextItemStart := 1
	if reviewStep != nil && reviewStep.HighestItemID > 0 {
		nextItemStart = reviewStep.HighestItemID + 1
	}
	if run.Round > 1 {
		fmt.Fprintf(&b, "复核原始意见及实际源码：先读 %s 和 %s；若存在也读 %s、%s。按原编号逐条说明已解决或仍存在，尊重作者裁决，检查本轮其他实际改动。控制块用 resolved 数组列出本轮已解决的旧编号，items 只列仍存在或新发现的问题。例如仅 R1 已解决且没有其他问题时，提交 {\"kind\":\"review\",\"resolved\":[\"R1\"],\"items\":[]}。新编号从 R%d 起。\n\n",
			DocRelPath(run.ID, run.previousDoc(DocReview)), DocRelPath(run.ID, run.previousDoc(DocReport)), DocRelPath(run.ID, run.previousDoc(DocResponse)), DocRelPath(run.ID, run.previousDoc(DocDecisions)), nextItemStart)
	}
	if reviewStep != nil && strings.TrimSpace(reviewStep.AuthorNote) != "" {
		fmt.Fprintf(&b, "作者在本轮追加了补充审核意见：请同时读取 %s，打开其中列出的附件作为核查材料，结合实际代码核查作者的意见；成立或需处理的事项请一并写入本轮审核意见正文及控制块的 items 数组（使用 R%d 起的新编号），与你的独立审核意见合并交付。\n\n",
			DocRelPath(run.ID, run.doc(authorReviewNoteFile)), nextItemStart)
	}
	b.WriteString(standards)
	b.WriteString("\n\n保持只读。审查功能和规范，规范类意见引用具体规则。每条写明真实文件与行号、触发条件和影响。输出完整审核意见，后台保存为 " + run.doc(DocReview) + "。最后另起一行输出控制块：\n" + reviewControlFormatSpec())
	return b.String()
}

func responseInstructions(run Run, missing []string) string {
	readTargets := DocRelPath(run.ID, run.doc(DocReview))
	if reviewStep := findStep(&run, StepReview); reviewStep != nil && strings.TrimSpace(reviewStep.AuthorNote) != "" {
		readTargets += "（并对照作者本轮补充意见 " + DocRelPath(run.ID, run.doc(authorReviewNoteFile)) + "）"
	}
	txt := fmt.Sprintf("读取 %s。逐条核实，接受的直接修改并注明具体文件和理由；有分歧的保留原状并说明理由，交给作者裁决。输出回应文档，后台写入 %s。末尾附控制块。\n", readTargets, run.doc(DocResponse))
	if len(missing) > 0 {
		txt += "继续补齐尚未回应的条目：" + strings.Join(missing, ", ") + "。\n"
	}
	return txt + responseControlFormatSpec()
}
func reportInstructions(run Run) string {
	docs := []string{run.doc(DocImpl), run.doc(DocReview)}
	if reviewStep := findStep(&run, StepReview); reviewStep != nil && strings.TrimSpace(reviewStep.AuthorNote) != "" {
		docs = append(docs, run.doc(authorReviewNoteFile))
	}
	if findStep(&run, StepResponse).Status != StepStatusSkipped {
		docs = append(docs, run.doc(DocResponse))
	}
	if findStep(&run, StepDecisions).Status == StepStatusDone {
		docs = append(docs, run.doc(DocDecisions))
	}
	for i, d := range docs {
		docs[i] = DocRelPath(run.ID, d)
	}
	return fmt.Sprintf("阅读 %s。按作者裁决完成修改并验证已认同的问题，运行项目相关测试。输出 %s 的正文，按意见编号写明处理结果、实际涉及文件、执行的命令、测试结果和遗留问题；后台保存文档。末尾附控制块，失败或跳过时写明原因。\n%s", strings.Join(docs, "、"), path.Base(run.doc(DocReport)), reportControlFormatSpec())
}

func saveTurnDocument(root string, run Run, doc, body string) error {
	if strings.TrimSpace(body) == "" {
		existing, err := ReadRunDoc(root, run.ID, run.doc(doc))
		if err == nil && strings.TrimSpace(existing) != "" {
			return nil
		}
		return fmt.Errorf("阶段缺少交付内容：%s", run.doc(doc))
	}
	_, err := WriteRunDoc(root, run.ID, run.doc(doc), body)
	return err
}

func renderReportDoc(body, command string, changes ChangeList) string {
	body = strings.TrimRight(body, "\r\n")
	command = strings.ReplaceAll(command, "\r\n", "\n")
	if command != "" && !strings.Contains(body, command) {
		body += "\n\n## 测试命令\n\n    " + strings.ReplaceAll(command, "\n", "\n    ")
	}
	return body + "\n\n" + changes.Markdown()
}
