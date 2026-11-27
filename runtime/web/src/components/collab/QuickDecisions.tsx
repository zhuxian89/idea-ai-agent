import { useEffect, useRef, useState } from "react";
import type { CollabReviewItem } from "../../services/collab";
import { CollabIcon, CollabIconButton } from "./CollabIcon";

export interface QuickDecisionDraft {
  decision: "accept_review" | "keep_primary" | "custom";
  note: string;
}

interface QuickDecisionsProps {
  items: CollabReviewItem[];
  choices: Record<string, QuickDecisionDraft>;
  readOnly: boolean;
  busy: boolean;
  onChoice: (itemId: string, choice: QuickDecisionDraft) => void;
  onBatchChoice: (decision: "accept_review" | "keep_primary") => void;
  onClose: () => void;
  onSubmit: () => void;
}

const DECISION_LABELS: Record<string, string> = {
  accept_review: "按审核改",
  keep_primary: "保留现状",
  custom: "其他指示",
};

function isLongText(text?: string): boolean {
  if (!text) return false;
  return text.length > 140 || text.includes("\n");
}

export function QuickDecisions({
  items,
  choices,
  readOnly,
  busy,
  onChoice,
  onBatchChoice,
  onClose,
  onSubmit,
}: QuickDecisionsProps) {
  const effectiveFor = (item: CollabReviewItem): { decision: string; note: string } => {
    if (readOnly) {
      return {
        decision: item.author_decision || choices[item.item_id]?.decision || "",
        note: item.author_note ?? choices[item.item_id]?.note ?? "",
      };
    }
    const draft = choices[item.item_id];
    return {
      decision: draft?.decision || "",
      note: draft?.note || "",
    };
  };

  const done = (item: CollabReviewItem): boolean => {
    const cur = effectiveFor(item);
    if (!cur.decision) return false;
    return cur.decision !== "custom" || cur.note.trim() !== "";
  };

  const [index, setIndex] = useState(() => {
    if (readOnly) return 0;
    const first = items.findIndex((item) => !done(item));
    return first >= 0 ? first : 0;
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [index]);

  const safeIndex = Math.min(index, Math.max(0, items.length - 1));
  const item = items[safeIndex];
  if (!item) return null;

  const decided = items.filter(done).length;
  const complete = items.length > 0 && decided === items.length;
  const firstOpen = items.findIndex((candidate) => !done(candidate));
  const last = safeIndex >= items.length - 1;
  const current = effectiveFor(item);
  const dialogTitle = readOnly ? "查看裁决" : "逐条裁决";

  const reviewKey = `${item.item_id}:review`;
  const primaryKey = `${item.item_id}:primary`;
  const reviewExpanded = !!expanded[reviewKey];
  const primaryExpanded = !!expanded[primaryKey];

  const primaryAction = readOnly
    ? last
      ? { label: "关闭", icon: "check" as const, run: onClose, disabled: false }
      : { label: "下一条", icon: "next" as const, run: () => setIndex(safeIndex + 1), disabled: false }
    : complete || items.length === 1 || (last && firstOpen === safeIndex)
      ? {
          label: busy ? "正在提交..." : "提交裁决并继续",
          icon: "check" as const,
          run: onSubmit,
          disabled: busy || !complete,
        }
      : last
        ? {
            label: `去处理第 ${firstOpen + 1} 条`,
            icon: "next" as const,
            run: () => setIndex(firstOpen),
            disabled: busy || firstOpen < 0,
          }
        : {
            label: "下一条",
            icon: "next" as const,
            run: () => setIndex(safeIndex + 1),
            disabled: busy || !done(item),
          };

  const lineRange =
    item.file_path
      ? `${item.file_path}:${item.line_start}${item.line_end && item.line_end !== item.line_start ? `-${item.line_end}` : ""}`
      : "";

  const selectOption = (decision: "accept_review" | "keep_primary" | "custom") => {
    if (readOnly || busy) return;
    onChoice(item.item_id, {
      decision,
      note: choices[item.item_id]?.note || "",
    });
  };

  return (
    <div className="collab-modal-backdrop" onClick={onClose}>
      <section
        className="collab-modal meeting-decision-modal"
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        data-readonly={readOnly ? "true" : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="collab-modal-head">
          <span>{dialogTitle}</span>
          <div className="decision-head-actions">
            <CollabIconButton icon="close" label={readOnly ? "关闭查看" : "关闭裁决"} onClick={onClose} />
          </div>
        </header>

        <nav className="decision-progress" aria-label="裁决进度">
          <div className="decision-progress-text">
            <strong>第 {safeIndex + 1} / {items.length} 条</strong>
            <span>{readOnly ? `已裁决 ${decided} 条` : `已处理 ${decided}`}</span>
          </div>
          {items.length > 1 && (
            <ol className="decision-steps">
              {items.map((candidate, position) => (
                <li key={candidate.item_id}>
                  <button
                    type="button"
                    aria-label={`第 ${position + 1} 条${done(candidate) ? "，已处理" : "，未处理"}`}
                    aria-current={position === safeIndex ? "step" : undefined}
                    data-done={done(candidate)}
                    onClick={() => setIndex(position)}
                  />
                </li>
              ))}
            </ol>
          )}
          {!readOnly && (
            <div className="quick-decision-batch">
              <span className="quick-decision-batch-label">快捷填充</span>
              <button
                type="button"
                className="quick-decision-batch-btn"
                disabled={busy}
                onClick={() => onBatchChoice("accept_review")}
              >
                全部按审核改
              </button>
              <button
                type="button"
                className="quick-decision-batch-btn"
                disabled={busy}
                onClick={() => onBatchChoice("keep_primary")}
              >
                全部保留现状
              </button>
            </div>
          )}
        </nav>

        <div className="collab-modal-body decision-body" ref={bodyRef}>
          <div className="decision-item-head">
            <div className="quick-decision-badges">
              <span className="meeting-item-id">{item.item_id}</span>
              <span className="quick-decision-dim">
                {item.dimension === "standard" ? "规范" : "功能"}
              </span>
              {readOnly && current.decision ? (
                <span className="collab-d-resolved-tag">
                  已裁决 · {DECISION_LABELS[current.decision] || current.decision}
                </span>
              ) : null}
            </div>
            <h3>{item.title}</h3>
            <div className="collab-d-source">
              {lineRange ? <span className="collab-mono collab-d-path">{lineRange}</span> : null}
              {item.citation_verified ? (
                <span className="collab-d-cite" data-verified="true">✓ 已核实</span>
              ) : (
                <span className="collab-d-cite" data-verified="false">
                  ⚠ {item.citation_note || "查无此处"}
                </span>
              )}
            </div>
            {item.rule_ref ? <div className="collab-d-rule">规范依据：{item.rule_ref}</div> : null}
          </div>

          <div className="decision-options" role="radiogroup" aria-label={`${item.item_id} 裁决`}>
            <div
              className="decision-option"
              data-selected={current.decision === "accept_review"}
              data-readonly={readOnly ? "true" : undefined}
            >
              <button
                type="button"
                role="radio"
                aria-checked={current.decision === "accept_review"}
                aria-disabled={readOnly || undefined}
                className="decision-option-main"
                onClick={() => selectOption("accept_review")}
              >
                <span className="decision-radio" aria-hidden="true" />
                <span className="decision-option-text">
                  <span className="decision-option-who">
                    <strong>按审核改</strong>
                    <span className="quick-decision-option-tag">
                      审核意见（{item.dimension === "standard" ? "规范" : "功能"}）
                    </span>
                  </span>
                  <span className="decision-option-quote" data-open={reviewExpanded}>
                    {item.description || "无详细说明"}
                  </span>
                </span>
              </button>
              {isLongText(item.description) && (
                <button
                  type="button"
                  className="decision-more"
                  aria-expanded={reviewExpanded}
                  onClick={() => setExpanded((old) => ({ ...old, [reviewKey]: !reviewExpanded }))}
                >
                  {reviewExpanded ? "收起" : "展开全文"}
                </button>
              )}
            </div>

            <div
              className="decision-option"
              data-selected={current.decision === "keep_primary"}
              data-readonly={readOnly ? "true" : undefined}
            >
              <button
                type="button"
                role="radio"
                aria-checked={current.decision === "keep_primary"}
                aria-disabled={readOnly || undefined}
                className="decision-option-main"
                onClick={() => selectOption("keep_primary")}
              >
                <span className="decision-radio" aria-hidden="true" />
                <span className="decision-option-text">
                  <span className="decision-option-who">
                    <strong>保留现状</strong>
                    <span className="quick-decision-option-tag">主模型说明</span>
                    {item.parse_fallback ? (
                      <span className="quick-decision-fallback-tag">解析兜底转交作者</span>
                    ) : null}
                  </span>
                  <span className="decision-option-quote" data-open={primaryExpanded}>
                    {item.primary_note || "无详细说明"}
                  </span>
                </span>
              </button>
              {isLongText(item.primary_note) && (
                <button
                  type="button"
                  className="decision-more"
                  aria-expanded={primaryExpanded}
                  onClick={() => setExpanded((old) => ({ ...old, [primaryKey]: !primaryExpanded }))}
                >
                  {primaryExpanded ? "收起" : "展开全文"}
                </button>
              )}
            </div>

            <div
              className="decision-option"
              data-selected={current.decision === "custom"}
              data-readonly={readOnly ? "true" : undefined}
            >
              <button
                type="button"
                role="radio"
                aria-checked={current.decision === "custom"}
                aria-disabled={readOnly || undefined}
                className="decision-option-main"
                onClick={() => selectOption("custom")}
              >
                <span className="decision-radio" aria-hidden="true" />
                <span className="decision-option-text">
                  <span className="decision-option-who">
                    <strong>其他指示</strong>
                  </span>
                </span>
              </button>
              {current.decision === "custom" ? (
                readOnly ? (
                  <div className="quick-decision-readonly-note">
                    {current.note || "未填写补充说明"}
                  </div>
                ) : (
                  <textarea
                    aria-label={`${item.item_id} 处理指示`}
                    value={current.note}
                    rows={3}
                    placeholder="输入对该条的具体处理指示..."
                    onChange={(event) =>
                      onChoice(item.item_id, { decision: "custom", note: event.target.value })
                    }
                  />
                )
              ) : null}
            </div>
          </div>
        </div>

        <footer className="decision-footer">
          {items.length > 1 && (
            <button
              type="button"
              className="collab-btn-secondary"
              disabled={busy || safeIndex === 0}
              onClick={() => setIndex(safeIndex - 1)}
            >
              上一条
            </button>
          )}
          <button
            type="button"
            className="collab-btn-primary"
            disabled={primaryAction.disabled}
            onClick={primaryAction.run}
          >
            <CollabIcon name={primaryAction.icon} />
            {primaryAction.label}
          </button>
        </footer>
      </section>
    </div>
  );
}
