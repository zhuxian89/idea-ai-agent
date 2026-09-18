import React, { memo, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { compareTurnDiffInIdea, openIdeaFile } from "../services/ideaBridge";
import { IdeaIconButton } from "./RelatedFileCompareButton";
import type { TurnDiffUpdate } from "../services/session";
import { DiffCodeTable } from "./DiffCodeTable";
import { parseTurnDiff, type TurnDiffFile } from "./turnDiffModel";

const kindLabel: Record<TurnDiffFile["kind"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

function TurnDiffSummaryInner({
  update,
  rootId,
  sessionKey,
}: {
  update: TurnDiffUpdate;
  rootId?: string | null;
  sessionKey?: string | null;
}) {
  const { t } = useI18n();
  const summary = useMemo(() => parseTurnDiff(update.diff), [update.diff]);
  const [expanded, setExpanded] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const selected = summary.files.find((file) => file.path === selectedPath) || null;
  const canCompare = Boolean(
    rootId && sessionKey && update.snapshotId &&
    update.comparePaths?.includes(selected?.path || "")
  );
  if (summary.files.length === 0) return null;

  return (
    <section
      data-turn-diff
      style={{
        width: "100%",
        minWidth: 0,
        border: "1px solid var(--border-color)",
        borderRadius: "10px",
        overflow: "hidden",
        background: "var(--background-color)",
        fontSize: "12px",
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        style={{
          width: "100%",
          border: 0,
          background: "transparent",
          color: "var(--text-primary)",
          padding: "9px 11px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span aria-hidden="true" style={{ color: "var(--text-secondary)", width: "10px" }}>{expanded ? "▾" : "▸"}</span>
        <strong style={{ fontWeight: 600 }}>{t("session.turnDiffFiles", { count: summary.files.length })}</strong>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: "7px", fontVariantNumeric: "tabular-nums" }}>
          {summary.additions > 0 ? <span style={{ color: "#16a34a" }}>+{summary.additions}</span> : null}
          {summary.deletions > 0 ? <span style={{ color: "#dc2626" }}>-{summary.deletions}</span> : null}
        </span>
      </button>

      {update.workspace ? (
        <div style={{ padding: "0 11px 8px", color: "var(--text-secondary)", fontSize: "11px" }}>
          {t("session.turnDiffWorkspaceNote")}
          {update.partial ? ` ${t("session.turnDiffPartialNote")}` : ""}
        </div>
      ) : null}

      {expanded ? (
        <div style={{ borderTop: "1px solid var(--border-color)" }}>
          {summary.files.map((file) => {
            const active = selected?.path === file.path;
            const displayPath = file.kind === "renamed" && file.oldPath
              ? `${file.oldPath} → ${file.path}`
              : file.path;
            const canCompareFile = Boolean(
              rootId && sessionKey && update.snapshotId &&
              update.comparePaths?.includes(file.path)
            );
            return (
              <div
                key={`${file.kind}:${file.path}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  borderBottom: "1px solid var(--border-color)",
                  background: active ? "rgba(59, 130, 246, 0.08)" : "transparent",
                }}
              >
                <button
                  type="button"
                  data-turn-diff-file={file.path}
                  aria-expanded={active}
                  onClick={() => setSelectedPath(active ? null : file.path)}
                  title={t("session.showTurnDiff", { path: file.path })}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 0,
                    background: "transparent",
                    color: "var(--text-primary)",
                    padding: "7px 11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    font: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: "14px", color: file.kind === "added" ? "#16a34a" : file.kind === "deleted" ? "#dc2626" : "#2563eb", fontWeight: 700 }}>
                    {kindLabel[file.kind]}
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayPath}</span>
                </button>
                {file.binary ? (
                  <span style={{ flexShrink: 0, color: "var(--text-secondary)", paddingRight: "2px" }}>{t("session.binaryDiff")}</span>
                ) : (
                  <span style={{ flexShrink: 0, display: "inline-flex", gap: "6px", paddingRight: "2px", fontVariantNumeric: "tabular-nums" }}>
                    {file.additions > 0 ? <span style={{ color: "#16a34a" }}>+{file.additions}</span> : null}
                    {file.deletions > 0 ? <span style={{ color: "#dc2626" }}>-{file.deletions}</span> : null}
                  </span>
                )}
                {rootId ? (
                  <IdeaIconButton
                    label={t("session.openInIdea")}
                    icon="open"
                    onClick={() => openIdeaFile(rootId, file.path)}
                  />
                ) : null}
                {canCompareFile ? (
                  <IdeaIconButton
                    label={t("session.compareTurnDiffInIdea")}
                    icon="compare"
                    onClick={() =>
                      compareTurnDiffInIdea({
                        rootId: rootId || "",
                        sessionKey: sessionKey || "",
                        snapshotId: update.snapshotId || "",
                        path: file.path,
                      })
                    }
                  />
                ) : null}
              </div>
            );
          })}
          {selected ? (
            <div data-turn-diff-detail style={{ padding: "9px 11px 11px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
                <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.path}</strong>
                <button
                  type="button"
                  aria-pressed={sideBySide}
                  onClick={() => setSideBySide((value) => !value)}
                  style={{ border: "1px solid var(--border-color)", borderRadius: "6px", background: sideBySide ? "rgba(59, 130, 246, 0.10)" : "transparent", color: "var(--accent-color)", padding: "3px 7px", cursor: "pointer", font: "inherit", whiteSpace: "nowrap" }}
                >
                  {t("fileTree.sideBySideDiff")}
                </button>
                {canCompare ? (
                  <button
                    type="button"
                    onClick={() => compareTurnDiffInIdea({
                      rootId: rootId || "",
                      sessionKey: sessionKey || "",
                      snapshotId: update.snapshotId || "",
                      path: selected.path,
                    })}
                    style={{ border: "1px solid var(--border-color)", borderRadius: "6px", background: "transparent", color: "var(--accent-color)", padding: "3px 7px", cursor: "pointer", font: "inherit", whiteSpace: "nowrap" }}
                  >
                    {t("session.compareTurnDiffInIdea")}
                  </button>
                ) : null}
                {rootId ? (
                  <button
                    type="button"
                    onClick={() => openIdeaFile(rootId, selected.path)}
                    style={{ marginLeft: "auto", border: "1px solid var(--border-color)", borderRadius: "6px", background: "transparent", color: "var(--accent-color)", padding: "3px 7px", cursor: "pointer", font: "inherit", whiteSpace: "nowrap" }}
                  >
                    {t("session.openInIdea")}
                  </button>
                ) : null}
              </div>
              {selected.binary ? (
                <div style={{ padding: "12px 0", color: "var(--text-secondary)" }}>{t("session.binaryDiff")}</div>
              ) : (
                <div style={{
                  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                  fontSize: "12px",
                  lineHeight: "19px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "7px",
                  overflow: "hidden",
                }}>
                  <DiffCodeTable content={selected.diff} sideBySide={sideBySide} />
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export const TurnDiffSummary = memo(TurnDiffSummaryInner);
