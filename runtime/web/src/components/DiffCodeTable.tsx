import React from "react";
import {
  buildDiffLines,
  buildSideBySideRows,
  buildUnifiedRows,
  getInlineDiffSegments,
  type DiffLine,
  type InlineDiffSegment,
} from "./gitDiffModel";

function lineBackground(kind: DiffLine["kind"]): string {
  if (kind === "add") return "rgba(34, 197, 94, 0.14)";
  if (kind === "del") return "rgba(239, 68, 68, 0.14)";
  if (kind === "hunk") return "rgba(59, 130, 246, 0.10)";
  return "transparent";
}

function lineColor(kind: DiffLine["kind"]): string {
  if (kind === "add") return "#166534";
  if (kind === "del") return "#991b1b";
  if (kind === "hunk") return "#1d4ed8";
  return "var(--text-primary)";
}

function displayLineNumber(line: DiffLine): string {
  return typeof line.newLine === "number" ? String(line.newLine) : "";
}

function displayOldLineNumber(line?: DiffLine): string {
  return line && typeof line.oldLine === "number" ? String(line.oldLine) : "";
}

function displayNewLineNumber(line?: DiffLine): string {
  return line && typeof line.newLine === "number" ? String(line.newLine) : "";
}

function inlineSegmentBackground(kind: DiffLine["kind"], segmentKind: InlineDiffSegment["kind"]): string {
  if (kind === "add" && segmentKind === "add") return "rgba(22, 163, 74, 0.22)";
  if (kind === "del" && segmentKind === "del") return "rgba(220, 38, 38, 0.22)";
  return "transparent";
}

function renderDiffLineContent(line: DiffLine, counterpart?: DiffLine, includePrefix = true): React.ReactNode {
  const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  if (!counterpart || line.kind === "ctx" || counterpart.kind === "ctx") {
    return `${includePrefix ? prefix : ""}${line.text || " "}`;
  }
  const oldText = line.kind === "del" ? line.text : counterpart.text;
  const newText = line.kind === "add" ? line.text : counterpart.text;
  const hiddenKind = line.kind === "add" ? "del" : "add";
  const visibleSegments = getInlineDiffSegments(oldText, newText).filter((segment) => segment.kind !== hiddenKind);
  return (
    <>
      {includePrefix ? <span>{prefix}</span> : null}
      {visibleSegments.length > 0
        ? visibleSegments.map((segment, index) => (
          <span
            key={`${index}-${segment.kind}-${segment.text}`}
            style={{
              background: inlineSegmentBackground(line.kind, segment.kind),
              borderRadius: segment.kind === "ctx" ? 0 : "3px",
            }}
          >
            {segment.text}
          </span>
        ))
        : <span>{line.text || " "}</span>}
    </>
  );
}

export function DiffCodeTable({ content, sideBySide = false }: { content: string; sideBySide?: boolean }) {
  const lines = React.useMemo(() => buildDiffLines(content), [content]);
  const sideBySideRows = React.useMemo(() => buildSideBySideRows(lines), [lines]);
  const unifiedRows = React.useMemo(() => buildUnifiedRows(lines), [lines]);
  return (
    <div style={{ overflowX: sideBySide ? "auto" : "hidden" }}>
      <div style={{ color: "var(--text-primary)", minWidth: sideBySide ? "680px" : 0 }}>
        {sideBySide
          ? sideBySideRows.map((row, index) => {
            if (row.kind === "hunk") {
              return (
                <div
                  key={`${index}-hunk`}
                  style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", background: lineBackground("hunk"), color: lineColor("hunk") }}
                >
                  <div style={{ padding: "0 10px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.hunkText || " "}</div>
                </div>
              );
            }
            const leftKind = row.left?.kind || "ctx";
            const rightKind = row.right?.kind || "ctx";
            return (
              <div
                key={`${index}-${row.left?.oldLine || 0}-${row.right?.newLine || 0}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "38px minmax(180px, 1fr) 38px minmax(180px, 1fr)",
                  alignItems: "stretch",
                  borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
                }}
              >
                <div style={{ padding: "0 5px 0 0", textAlign: "right", color: "var(--text-secondary)", opacity: 0.55, userSelect: "none", fontVariantNumeric: "tabular-nums", background: row.left ? lineBackground(leftKind) : "rgba(148, 163, 184, 0.05)" }}>
                  {displayOldLineNumber(row.left)}
                </div>
                <div style={{ padding: "0 9px 0 5px", whiteSpace: "pre-wrap", wordBreak: "break-word", background: row.left ? lineBackground(leftKind) : "rgba(148, 163, 184, 0.05)", color: row.left ? lineColor(leftKind) : "var(--text-secondary)", borderRight: "1px solid var(--border-color)" }}>
                  {row.left ? renderDiffLineContent(row.left, row.right) : " "}
                </div>
                <div style={{ padding: "0 5px 0 0", textAlign: "right", color: "var(--text-secondary)", opacity: 0.55, userSelect: "none", fontVariantNumeric: "tabular-nums", background: row.right ? lineBackground(rightKind) : "rgba(148, 163, 184, 0.05)" }}>
                  {displayNewLineNumber(row.right)}
                </div>
                <div style={{ padding: "0 9px 0 5px", whiteSpace: "pre-wrap", wordBreak: "break-word", background: row.right ? lineBackground(rightKind) : "rgba(148, 163, 184, 0.05)", color: row.right ? lineColor(rightKind) : "var(--text-secondary)" }}>
                  {row.right ? renderDiffLineContent(row.right, row.left) : " "}
                </div>
              </div>
            );
          })
          : unifiedRows.map((row, index) => {
            if (row.kind === "hunk") {
              return (
                <div
                  key={`${index}-hunk`}
                  style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", background: lineBackground("hunk"), color: lineColor("hunk") }}
                >
                  <div style={{ padding: "0 10px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.hunkText || " "}</div>
                </div>
              );
            }
            const line = row.line;
            return (
              <div
                key={`${index}-${line.kind}-${line.oldLine || 0}-${line.newLine || 0}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "30px 12px minmax(0, 1fr)",
                  alignItems: "stretch",
                  background: lineBackground(line.kind),
                  color: lineColor(line.kind),
                }}
              >
                <div style={{ padding: "0 4px 0 0", textAlign: "right", color: "var(--text-secondary)", opacity: 0.55, userSelect: "none", fontVariantNumeric: "tabular-nums" }}>
                  {displayLineNumber(line)}
                </div>
                <div style={{ userSelect: "none", fontWeight: 700 }}>
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : line.kind === "ctx" ? " " : ""}
                </div>
                <div style={{ padding: "0 9px 0 4px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {renderDiffLineContent(line, row.counterpart, false)}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
