import React from "react";
import { type DirectorySortMode, type FileEntry } from "../services/directorySort";
import { type AppearanceMode } from "../services/appearance";
import { type Locale, type MessageKey } from "../i18n";
import { type AgentLifecycleCommandAction } from "./AgentLifecyclePopover";

export const APPEARANCE_OPTIONS: Array<{ value: AppearanceMode; labelKey: MessageKey }> = [
  { value: "dark", labelKey: "appearance.dark" },
  { value: "light", labelKey: "appearance.light" },
  { value: "meadow", labelKey: "appearance.meadow" },
  { value: "moss", labelKey: "appearance.moss" },
  { value: "system", labelKey: "appearance.system" },
];

export const LOCALE_OPTIONS: Array<{ value: Locale; labelKey: MessageKey }> = [
  { value: "zh-CN", labelKey: "locale.zhCN" },
  { value: "en-US", labelKey: "locale.enUS" },
];

export const DIRECTORY_SORT_LABEL_KEYS: Partial<Record<DirectorySortMode, MessageKey>> = {
  "name-asc": "sort.nameAsc",
  "name-desc": "sort.nameDesc",
  "mtime-desc": "sort.mtimeDesc",
  "mtime-asc": "sort.mtimeAsc",
  "size-desc": "sort.sizeDesc",
  "size-asc": "sort.sizeAsc",
};

export type FileMeta = {
  source_session?: string;
  session_name?: string;
};

export type RootSessionIndicator = {
  bound?: boolean;
  pending?: boolean;
};

export type ProjectTreeTab = "files" | "git" | "worktrees" | "related";

export type AgentConfigSwitchRequest = {
  nonce: number;
  providerIDs?: string[];
};

export const PROJECT_TREE_TAB_STORAGE_KEY = "mindfs-project-tree-tab";

export const PROJECT_TREE_ROOT_PADDING_LEFT = 0;

export const PROJECT_TREE_INDENT = 16;

export function isProjectTreeTab(value: unknown): value is ProjectTreeTab {
  return value === "files" || value === "git" || value === "worktrees" || value === "related";
}

export type FileTreeProps = {
  onProjectAdded?: (rootId: string) => void | Promise<void>;
  agentSettingsOnly?: boolean;
  agentSettingsActive?: boolean;
  agentsVersion?: number;
  entries: FileEntry[];
  childrenByPath: Record<string, FileEntry[]>;
  expanded: string[];
  sortMode: DirectorySortMode;
  showHiddenFiles?: boolean;
  selectedDirKey?: string | null;
  selectedPath?: string | null;
  rootId?: string | null;
  rootSessionIndicators?: Record<string, RootSessionIndicator>;
  fileMetas?: Record<string, FileMeta>;
  activeSessionKey?: string | null;
  onSortModeChange?: (mode: DirectorySortMode) => void;
  onShowHiddenFilesChange?: (show: boolean) => void;
  onRefresh?: (tab: ProjectTreeTab) => void | Promise<void>;
  onSelectFile?: (entry: FileEntry, rootId: string) => void;
  onSelectRoot?: (entry: FileEntry, rootId: string) => void;
  onToggleDir?: (entry: FileEntry, rootId: string) => void;
  renderRootExtraContent?: (rootId: string) => React.ReactNode;
  renderRootWorktreeContent?: (rootId: string) => React.ReactNode;
  renderRootRelatedContent?: (rootId: string) => React.ReactNode;
  projectTreeTabRequest?: { tab: ProjectTreeTab; nonce: number } | null;
  agentConfigSwitchRequest?: AgentConfigSwitchRequest | null;
  agentMenuRequest?: number | null;
  onAgentMenuOpened?: () => void;
  onAgentConfigSwitched?: (agent: string) => void;
  onProjectTreeTabChange?: (tab: ProjectTreeTab) => void;
  relayActionLabel?: string | null;
  relayActionDisabled?: boolean;
  relayActionHelp?: string | null;
  /** 页脚里“手机扫码连接”按钮上方的内容，例如电脑状态。 */
  footerTop?: React.ReactNode;
  publicStandaloneVersion?: string;
  onRelayAction?: () => void;
  relayNodeId?: string;
  relayBaseURL?: string;
  relayNoRelayer?: boolean;
  updateActionLabel?: string | null;
  updateActionDisabled?: boolean;
  updateActionHelp?: string | null;
  updateActionBusy?: boolean;
  updateActionSummary?: string | null;
  onUpdateAction?: () => void;
  sidebarsSwapped?: boolean;
  onSidebarsSwappedChange?: (enabled: boolean) => void;
  gitDiffSideBySide?: boolean;
  onGitDiffSideBySideChange?: (enabled: boolean) => void;
  multiProjectSessionsEnabled?: boolean;
  onMultiProjectSessionsChange?: (enabled: boolean) => void;
  onRunAgentLifecycleCommand?: (agentName: string, action: AgentLifecycleCommandAction, commands: string[]) => void | Promise<void>;
  onRestartAgent?: (agentName: string) => void | Promise<void>;
  onGoHome?: () => void;
};

export type AgentConfigPresentation = "sidebar" | "dialog";
