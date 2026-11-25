import React from "react";
import { useI18n } from "../i18n";
import type {
  GitHistoryItem,
  GitHistoryPayload,
  GitStatusItem,
  GitStatusPayload,
} from "../services/git";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { GitStatusPanel } from "./GitStatusPanel";

export type RootGitSidebarPanelProps = {
  root: string;
  isGitRepo: boolean;
  gitStatus: GitStatusPayload | null;
  gitHistory: GitHistoryPayload | null;
  gitStatusLoading: boolean;
  gitHistoryLoading: boolean;
  gitHistoryLoadingMore: boolean;
  gitStatusExpanded: boolean;
  gitHistoryExpandedCommits: Record<string, boolean>;
  onRefresh: () => void;
  onExpandedChange: (expanded: boolean) => void;
  onSelectDiff: (item: GitStatusItem) => void;
  onOpenItem: (item: GitStatusItem) => void;
  onDiscardItem: (item: GitStatusItem) => void | Promise<void>;
  onStageItem: (item: GitStatusItem) => void | Promise<void>;
  onPull: () => void | Promise<void>;
  onPush: () => void | Promise<void>;
  onCommit: (message: string) => void | Promise<void>;
  onSwitchBranch: (branch: string) => void | Promise<void>;
  onToggleCommit: (hash: string) => void;
  onLoadMoreHistory: () => void;
  onSelectCommitFile: (commit: GitHistoryItem, item: GitStatusItem) => void;
};

export function RootGitSidebarPanel({
  root,
  isGitRepo,
  gitStatus,
  gitHistory,
  gitStatusLoading,
  gitHistoryLoading,
  gitHistoryLoadingMore,
  gitStatusExpanded,
  gitHistoryExpandedCommits,
  onRefresh,
  onExpandedChange,
  onSelectDiff,
  onOpenItem,
  onDiscardItem,
  onStageItem,
  onPull,
  onPush,
  onCommit,
  onSwitchBranch,
  onToggleCommit,
  onLoadMoreHistory,
  onSelectCommitFile,
}: RootGitSidebarPanelProps) {
  const { t } = useI18n();
  const statusAvailable = gitStatus?.available === true;
  const historyAvailable = gitHistory?.available === true;
  const shouldRenderGitPanel = gitStatusLoading || statusAvailable;
  const shouldRenderGitHistoryPanel =
    gitHistoryLoading ||
    (historyAvailable && (gitHistory?.items.length || 0) > 0);

  if (!isGitRepo) {
    return (
      <div
        style={{
          padding: "8px 4px",
          fontSize: "12px",
          color: "var(--text-secondary)",
        }}
      >
        {t("git.notRepository")}
      </div>
    );
  }
  if (!gitStatus && !gitHistory && !gitStatusLoading && !gitHistoryLoading) {
    return (
      <button
        type="button"
        onClick={onRefresh}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--text-secondary)",
          borderRadius: "6px",
          padding: "8px 4px",
          fontSize: "12px",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
        }}
      >
        {t("git.loadingStatus")}
      </button>
    );
  }
  if (
    !gitStatusLoading &&
    !gitHistoryLoading &&
    !shouldRenderGitPanel &&
    !shouldRenderGitHistoryPanel
  ) {
    return (
      <div
        style={{
          padding: "8px 4px",
          fontSize: "12px",
          color: "var(--text-secondary)",
        }}
      >
        {t("git.emptyChangesOrHistory")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        minWidth: 0,
      }}
    >
      {shouldRenderGitPanel ? (
        <GitStatusPanel
          rootId={root}
          status={gitStatus}
          loading={gitStatusLoading}
          compact
          expanded={gitStatusExpanded}
          onExpandedChange={onExpandedChange}
          onSelectItem={onSelectDiff}
          onOpenItem={onOpenItem}
          onDiscardItem={onDiscardItem}
          onStageItem={onStageItem}
          onPull={onPull}
          onPush={onPush}
          onCommit={onCommit}
          onSwitchBranch={onSwitchBranch}
        />
      ) : null}
      {shouldRenderGitHistoryPanel ? (
        <GitHistoryPanel
          rootId={root}
          items={gitHistory?.items || []}
          loading={gitHistoryLoading}
          loadingMore={gitHistoryLoadingMore}
          hasMore={gitHistory?.has_more === true}
          compact
          expandedCommits={gitHistoryExpandedCommits}
          onToggleCommit={onToggleCommit}
          onLoadMore={onLoadMoreHistory}
          onSelectFile={onSelectCommitFile}
        />
      ) : null}
    </div>
  );
}
