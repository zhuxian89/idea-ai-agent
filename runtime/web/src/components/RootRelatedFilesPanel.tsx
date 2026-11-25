import React from "react";
import {
  normalizePath,
  relatedFileSelectionKey,
} from "../app/fileNavigation";
import {
  relatedFileStatKey,
  type RelatedFileStat,
} from "../hooks/useRelatedFileStats";
import { useI18n } from "../i18n";
import { compareGitFileInIdea, isIdeaRuntime } from "../services/ideaBridge";
import { RelatedFileCompareButton } from "./RelatedFileCompareButton";

export type NormalizedRelatedFile = {
  path: string;
  name: string;
  head: string;
  repo_path: string;
  repo_name: string;
  repo_kind: string;
  root_id: string;
};

export type RelatedFileGroup = {
  key: string;
  head: string;
  repoPath: string;
  repoName: string;
  repoKind: string;
  files: NormalizedRelatedFile[];
};

export type RootRelatedFilesPanelProps = {
  root: string;
  rootPath: string;
  hasSessionSnapshot: boolean;
  fileCount: number;
  groups: RelatedFileGroup[];
  relatedFileStatsByKey: Record<string, RelatedFileStat>;
  gitFileStatsByPath: Record<string, RelatedFileStat>;
  relatedSelectedFileKey: string;
  relatedSelectedPath: string;
  onSelectFile: (file: NormalizedRelatedFile) => void;
  onRemoveFile: (file: NormalizedRelatedFile) => void;
};

export function RootRelatedFilesPanel({
  root,
  rootPath,
  hasSessionSnapshot,
  fileCount,
  groups,
  relatedFileStatsByKey,
  gitFileStatsByPath,
  relatedSelectedFileKey,
  relatedSelectedPath,
  onSelectFile,
  onRemoveFile,
}: RootRelatedFilesPanelProps) {
  const { t } = useI18n();

  if (!hasSessionSnapshot) {
    return (
      <div
        style={{
          padding: "8px 4px",
          fontSize: "12px",
          color: "var(--text-secondary)",
        }}
      >
        {t("session.empty")}
      </div>
    );
  }
  if (fileCount === 0) {
    return (
      <div
        style={{
          padding: "8px 4px",
          fontSize: "12px",
          color: "var(--text-secondary)",
        }}
      >
        {t("session.relatedFiles", { count: 0 })}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        minWidth: 0,
      }}
    >
      {groups.map((group) => {
        const isCurrentRepo =
          !group.repoPath ||
          normalizePath(group.repoPath) === normalizePath(rootPath);
        const showGroupHeader =
          group.repoKind === "plain" || group.head || !isCurrentRepo;
        return (
          <div
            key={group.key}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              minWidth: 0,
            }}
          >
            {showGroupHeader ? (
              <div
                title={
                  [group.repoPath, group.head].filter(Boolean).join(" · ") ||
                  group.repoName ||
                  t("session.currentProject")
                }
                style={{
                  padding: "3px 6px 0",
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  fontFamily: group.head
                    ? "var(--mono-font, monospace)"
                    : undefined,
                }}
              >
                {group.repoKind === "plain"
                  ? `${group.repoName || t("session.currentProject")} · ${t("session.nonGit")}`
                  : group.head
                    ? isCurrentRepo
                      ? `HEAD ${group.head.slice(0, 8)}`
                      : `${group.repoName || t("session.currentProject")} · HEAD ${group.head.slice(0, 8)}`
                    : group.repoName || t("session.currentProject")}
              </div>
            ) : null}
            {group.files.map((file) => {
              const stats =
                relatedFileStatsByKey[relatedFileStatKey(file)] ||
                gitFileStatsByPath[file.path];
              const fileSelectionKey = relatedFileSelectionKey(file);
              const isSelected = relatedSelectedFileKey
                ? fileSelectionKey === relatedSelectedFileKey
                : file.path === relatedSelectedPath;
              return (
                <div
                  key={`${file.head || "legacy"}:${file.path}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    minWidth: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectFile(file)}
                    title={file.path}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "none",
                      background: isSelected
                        ? "var(--selection-bg)"
                        : "transparent",
                      color: isSelected
                        ? "var(--accent-color)"
                        : "var(--text-primary)",
                      borderRadius: "6px",
                      padding: "5px 6px",
                      display: "flex",
                      alignItems: "center",
                      gap: "7px",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: isSelected ? 700 : 400,
                    }}
                  >
                    <span
                      style={{
                        width: "16px",
                        display: "inline-flex",
                        justifyContent: "center",
                        color: "#94a3b8",
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" x2="8" y1="13" y2="13" />
                        <line x1="16" x2="8" y1="17" y2="17" />
                      </svg>
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.name}
                    </span>
                    {stats ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            color: "#15803d",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          +{stats.additions}
                        </span>
                        <span
                          style={{
                            color: "#b91c1c",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          -{stats.deletions}
                        </span>
                      </span>
                    ) : null}
                  </button>
                  {isIdeaRuntime &&
                  stats &&
                  file.repo_kind !== "plain" &&
                  stats.source !== "commit_range" ? (
                    <RelatedFileCompareButton
                      onClick={() =>
                        compareGitFileInIdea({
                          rootId: root,
                          path: file.path,
                          repoPath: file.repo_path || undefined,
                          repoKind: file.repo_kind || undefined,
                        })
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-label={t("session.removeRelatedFile", {
                      name: file.name || file.path,
                    })}
                    title={t("session.removeRelatedFile", {
                      name: file.name || file.path,
                    })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveFile(file);
                    }}
                    style={{
                      width: "18px",
                      height: "18px",
                      border: "none",
                      borderRadius: "5px",
                      background: "transparent",
                      color: "#dc2626",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                      cursor: "pointer",
                      flexShrink: 0,
                      fontSize: "13px",
                    }}
                  >
                    x
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
