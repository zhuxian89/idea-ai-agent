import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createConnectionEventHandler } from "./app/events/connectionEvents";
import { createFileChangeHandlers } from "./app/events/fileChanges";
import { createSessionLifecycleHandler } from "./app/events/sessionLifecycle";
import { createSessionReplay } from "./app/events/sessionReplay";
import { createSessionStreamHandlers } from "./app/events/sessionStream";
import { createSlashCommandHandlers } from "./app/events/slashCommands";
import { createWorkspaceEventHandler } from "./app/events/workspaceEvents";
import {
  AttachedFileContext,
  basenameOfPath,
  buildDirectorySelectionKey,
  buildFileScrollKey,
  dirnameOfPath,
  GitFileStat,
  joinDisplayPath,
  normalizePath,
  normalizePathForRoot,
  parentDirsOfFile,
  parseFileLocation,
  RelatedFileClickTarget,
  relatedFileSelectionKey,
  relativeDisplayPathFromRoot,
  ViewerSelection,
} from "./app/fileNavigation";
import { ChevronDownSmallIcon, ImportIcon } from "./app/icons";
import {
  buildMatchInputFromPath,
  inferReadModeFromPlugin,
  toPluginInput,
} from "./app/pluginInput";
import { navigatePopup, openPendingPopup } from "./app/popupNavigation";
import { ManagedRootPayload } from "./app/projectModel";
import { URLState, WSStatus } from "./app/runtimeTypes";
import {
  hasSessionExchanges,
  isTopLevelSessionItem,
  MultiProjectSessionGroup,
  OpenSessionTab,
  PendingSend,
  sessionInputHistory,
  SessionItem,
  SessionQueueItem,
  SlashCommandResult,
  toSessionItem,
} from "./app/sessionModel";
import {
  normalizeUpdateState,
  shouldShowUpdateButton,
  updateButtonLabel,
  updateSummaryText,
} from "./app/updatePresentation";
import { useMessageSending } from "./app/useMessageSending";
import { useSessionCache } from "./app/useSessionCache";
import { useSessionNavigation } from "./app/useSessionNavigation";
import { useWorkspaceGit } from "./app/useWorkspaceGit";
import { ActionBar } from "./components/ActionBar";
import { AgentIcon } from "./components/AgentIcon";
import { AgentMenuList } from "./components/AgentMenuList";
import { BottomSheet } from "./components/BottomSheet";
import { DefaultListView } from "./components/DefaultListView";
import { ExternalSessionList } from "./components/ExternalSessionList";
import { FileTree, type ProjectTreeTab } from "./components/FileTree";
import { FileViewer } from "./components/FileViewer";
import { GitDiffViewer } from "./components/GitDiffViewer";
import { GitHistoryPanel } from "./components/GitHistoryPanel";
import { GitStatusPanel } from "./components/GitStatusPanel";
import { ModeIcon } from "./components/ModeIcon";
import { RelatedFileCompareButton } from "./components/RelatedFileCompareButton";
import { ConnectionErrorDialog } from "./components/remote/ConnectionErrorDialog";
import { RemoteAccessRequired } from "./components/remote/RemoteAccessRequired";
import { RemoteFileViewer } from "./components/remote/RemoteFileViewer";
import { ScheduledAgentTaskDialog } from "./components/ScheduledAgentTaskDialog";
import {
  MultiProjectSessionList,
  SessionList,
  type ProjectSessionGroup,
} from "./components/SessionList";
import { SessionTabs, type SessionTabItem } from "./components/SessionTabs";
import { SessionViewer } from "./components/SessionViewer";
import { ToastContainer } from "./components/Toast";

import { UserMessageSummaryButton } from "./components/UserMessageSummaryButton";
import type { RunningSubagent } from "./services/runningSubagents";
import {
  relatedFileStatKey,
  useRelatedFileStats,
} from "./hooks/useRelatedFileStats";
import { buildBaseTimeline } from "./hooks/useSessionStream";
import { translateNow, useI18n } from "./i18n";
import { AppShell } from "./layout/AppShell";
import {
  loadPluginsFromSources,
  PluginManager,
  scanPluginSources,
  snapshotFromPluginSources,
  type PluginSourceBundle,
} from "./plugins/manager";
import {
  isPluginSnapshotTrusted,
  readTrustedPluginSet,
  saveTrustedPluginSet,
} from "./plugins/trust";
import { Renderer } from "./renderer/Renderer";
import { fetchAgents, restartAgent, type AgentStatus } from "./services/agents";
import {
  protectedJSON as apiProtectedJSON,
  ProtectedAPIError,
  protectedAPIReady,
} from "./services/api";
import { appPath, appURL, isRelayNodePage } from "./services/base";
import {
  bootstrapService,
  type BootstrapState,
  type RelayStatusPayload,
} from "./services/bootstrap";
import { copyText } from "./services/clipboard";
import {
  DEFAULT_DIRECTORY_SORT_MODE,
  type DirectorySortMode,
  type FileEntry,
} from "./services/directorySort";
import { e2eeService, type E2EEState } from "./services/e2ee";
import { reportError } from "./services/error";
import {
  clearFileCacheForRoot,
  fetchEditableFile,
  fetchFile,
  getCachedFile,
  invalidateFileCache,
  saveTextFile,
  type FilePayload,
} from "./services/file";
import { FileEditStore } from "./services/fileEditing";
import {
  clearGitHistoryCache,
  fetchGitRelatedFileDiff,
  fetchGitStatusByPath,
  fetchGitWorktrees,
  type GitStatusPayload,
  type GitWorktreeItem,
} from "./services/git";
import {
  compareGitFileInIdea,
  isIdeaRuntime,
  isIDEManagedProject,
  openIdeaFile,
} from "./services/ideaBridge";
import { storeRelayNodes } from "./services/launcherNodeSync";
import {
  cancelScheduledWebViewCacheClear,
  scheduleWebViewCacheClearOnNextLaunch,
} from "./services/nativeCacheControl";
import { projectStorage } from "./services/remoteScope";
import { syncNativeReplyPollerE2EE } from "./services/replyPoller";
import { isNativeShellRuntime } from "./services/runtime";
import {
  clearCachedSessionsForRoot,
  getCachedMultiRootSessionList,
  getCachedSessionList,
  hasCurrentActivityHistory,
  saveCachedMultiRootSessionList,
  saveCachedSessionList,
  sessionService,
  setCachedSessionRelatedFiles,
  type MultiRootSessionGroup,
  type RelatedFile,
  type Session,
  type SyncSessionResult,
} from "./services/session";
import {
  applyPinnedSnapshotToSessions,
  mergeSessionItems,
} from "./services/sessionListMerge";
import { triggerUpdate, type UpdateState } from "./services/update";
import {
  isUploadAbortError,
  uploadFiles,
  type UploadProgress,
} from "./services/upload";

// 直接导入标准组件

const WorkspaceFileViewer = isIdeaRuntime ? FileViewer : RemoteFileViewer;

// 类型定义

const CHILD_SESSION_PAGE_SIZE = 100;
const MULTI_PROJECT_SESSION_LIMIT = 6;
const SESSION_PAGE_SIZE = 50;
const MULTI_PROJECT_SESSION_STORAGE_KEY = "mindfs-multi-project-session-list";
const APP_DOCUMENT_TITLE = "MindFS";

function formatDocumentTitle(relayStatus: RelayStatusPayload | null): string {
  if (!isRelayNodePage()) {
    return APP_DOCUMENT_TITLE;
  }
  const nodeName = String(relayStatus?.node_name || "").trim();
  return nodeName ? `${nodeName} - ${APP_DOCUMENT_TITLE}` : APP_DOCUMENT_TITLE;
}

const RELAY_LAST_NODE_ID_STORAGE_KEY = "mindfs.relay.last_node_id";
const PLUGIN_QUERY_STORAGE_PREFIX = "vp-progress:";
const TREE_SORT_STORAGE_KEY = "mindfs-tree-sort-mode";
const DIRECTORY_SORT_OVERRIDES_STORAGE_KEY = "mindfs-directory-sort-overrides";
const FILE_SCROLL_STORAGE_KEY = "mindfs-file-scroll-positions";
const LAST_ROOT_STORAGE_KEY = "mindfs-last-root-id";
const GIT_STATUS_EXPANDED_STORAGE_KEY = "mindfs-git-status-expanded";
const GIT_HISTORY_EXPANDED_STORAGE_KEY = "mindfs-git-history-expanded";

function relayNodeIdFromPathname(pathname: string): string {
  const match = /^\/n\/([^/]+)/.exec(String(pathname || ""));
  return match?.[1] || "";
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    navigatorWithStandalone.standalone === true
  );
}

function isRelayPWAContext(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    isStandaloneDisplayMode() &&
    (/^\/n\/[^/]+/.test(window.location.pathname) ||
      window.location.pathname === "/nodes" ||
      window.location.pathname === "/login")
  );
}

function isRelayNodesPage(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (window.location.pathname.replace(/\/+$/, "") || "/") === "/nodes";
}

function relayNodeURL(rootID: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  const trimmed = String(rootID || "").trim();
  if (!trimmed) {
    return "";
  }
  return new URL(
    `/n/${encodeURIComponent(trimmed)}/`,
    window.location.origin,
  ).toString();
}

function syncRelayNodesToNative(dirs: ManagedRootPayload[]): void {
  if (
    (!isNativeShellRuntime() && !isRelayPWAContext()) ||
    !isRelayNodesPage()
  ) {
    return;
  }
  const nodes = dirs
    .map((dir) => {
      const id = String(dir.id || "").trim();
      const url = relayNodeURL(id);
      const name = String(
        dir.display_name ||
          dir.root_path?.split("/").filter(Boolean).pop() ||
          id,
      ).trim();
      if (!id || !url || !name) {
        return null;
      }
      return { name, url };
    })
    .filter((node): node is { name: string; url: string } => node !== null);
  void storeRelayNodes(nodes);
}

function extractHTTPStatusFromErrorMessage(message: string): number | null {
  const match = /status=(\d{3})|(?:^|:\s)(\d{3})\s[A-Z]/.exec(
    String(message || ""),
  );
  const raw = match?.[1] || match?.[2];
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadPersistedFileScrollPositions(): Record<string, number> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = projectStorage().getItem(FILE_SCROLL_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const next: Record<string, number> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      const scrollTop = Number(value);
      if (!key || !Number.isFinite(scrollTop) || scrollTop < 0) {
        return;
      }
      next[key] = scrollTop;
    });
    return next;
  } catch {
    return {};
  }
}

function persistFileScrollPositions(positions: Record<string, number>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    projectStorage().setItem(
      FILE_SCROLL_STORAGE_KEY,
      JSON.stringify(positions),
    );
  } catch {}
}

function parsePluginQuery(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const query: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key.startsWith("vp_")) {
      query[key.slice("vp_".length)] = value;
    }
  });
  return query;
}

function parseCursor(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeCursor(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function isDirectorySortMode(
  value: string | null | undefined,
): value is DirectorySortMode {
  return (
    value === "name-asc" ||
    value === "name-desc" ||
    value === "mtime-desc" ||
    value === "mtime-asc" ||
    value === "size-desc" ||
    value === "size-asc"
  );
}

function readURLState(): URLState {
  const params = new URLSearchParams(window.location.search);
  return {
    root: params.get("root") || "",
    file: params.get("file") || "",
    session: params.get("session") || "",
    cursor: parseCursor(params.get("cursor")),
    pluginQuery: parsePluginQuery(window.location.search),
  };
}

function buildURLSearch(next: URLState): string {
  const params = new URLSearchParams();
  // Session/file navigation rewrites the URL. Preserve the native host flags
  // so a reload still hides the web toolbar and subscribes to title actions.
  const current = new URLSearchParams(window.location.search);
  if (current.get("ide_chrome") === "1") params.set("ide_chrome", "1");
  const ideaTheme = current.get("ide_theme");
  if (ideaTheme === "dark" || ideaTheme === "light")
    params.set("ide_theme", ideaTheme);
  if (next.root) params.set("root", next.root);
  if (next.file) params.set("file", next.file);
  if (next.session) params.set("session", next.session);
  if (next.cursor > 0) params.set("cursor", String(next.cursor));
  Object.entries(next.pluginQuery).forEach(([key, value]) => {
    if (!key) return;
    params.set(`vp_${key}`, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function pluginQueryStorageKey(root: string, file: string): string {
  return `${PLUGIN_QUERY_STORAGE_PREFIX}${root}:${file}`;
}

function loadPersistedPluginQuery(
  root: string,
  file: string,
): Record<string, string> {
  if (!root || !file) return {};
  try {
    const raw = projectStorage().getItem(pluginQueryStorageKey(root, file));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const next: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(
      ([key, value]) => {
        if (!key) return;
        next[key] = String(value);
      },
    );
    return next;
  } catch {
    return {};
  }
}

function persistPluginQuery(
  root: string,
  file: string,
  query: Record<string, string>,
): void {
  if (!root || !file) return;
  try {
    projectStorage().setItem(
      pluginQueryStorageKey(root, file),
      JSON.stringify(query || {}),
    );
  } catch {}
}

function removeLocalStorageByPrefix(prefix: string): void {
  if (typeof window === "undefined" || !prefix) {
    return;
  }
  try {
    for (const key of Array.from(
      { length: projectStorage().length },
      (_, index) => projectStorage().key(index),
    ).filter(Boolean) as string[]) {
      if (key.startsWith(prefix)) {
        projectStorage().removeItem(key);
      }
    }
  } catch {}
}

function mapManagedRootsToEntries(dirs: ManagedRootPayload[]): FileEntry[] {
  return dirs.map((dir) => ({
    name: dir.display_name || dir.id.split("/").filter(Boolean).pop() || dir.id,
    path: dir.id,
    is_dir: true,
    is_root: true,
    size: typeof dir.size === "number" ? dir.size : undefined,
    mtime: typeof dir.mtime === "string" ? dir.mtime : undefined,
  }));
}

function comparableManagedRootPath(value: string | undefined): string {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

function loadLastRootId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return projectStorage().getItem(LAST_ROOT_STORAGE_KEY) || "";
}

function loadBooleanRecord(key: string): Record<string, boolean> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(projectStorage().getItem(key) || "{}") as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "boolean"),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function loadStringBooleanRecord(
  key: string,
): Record<string, Record<string, boolean>> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(projectStorage().getItem(key) || "{}") as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(parsed).map(([root, value]) => [
        root,
        value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).filter(
                ([, expanded]) => typeof expanded === "boolean",
              ),
            )
          : {},
      ]),
    ) as Record<string, Record<string, boolean>>;
  } catch {
    return {};
  }
}

// Hook for responsive detection
function useResponsive() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkSize = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768);
    };
    checkSize();
    window.addEventListener("resize", checkSize);
    return () => window.removeEventListener("resize", checkSize);
  }, []);
  return { isMobile };
}

type AppProps = {
  onGoHome?: () => void;
};

const SIDEBARS_SWAPPED_STORAGE_KEY = "mindfs-sidebars-swapped";
const GIT_DIFF_SIDE_BY_SIDE_STORAGE_KEY = "mindfs-git-diff-side-by-side";

function loadSidebarsSwapped(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return projectStorage().getItem(SIDEBARS_SWAPPED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function loadGitDiffSideBySide(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return projectStorage().getItem(GIT_DIFF_SIDE_BY_SIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function App({ onGoHome }: AppProps) {
  const [fileEditStore] = useState(
    () => new FileEditStore({ load: fetchEditableFile, save: saveTextFile }),
  );
  useEffect(() => {
    let leavingProject = false;
    const guard = (event: BeforeUnloadEvent) => {
      if (!leavingProject && fileEditStore.hasDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const leaveProject = (event: Event) => {
      if (event.defaultPrevented) return;
      if (
        fileEditStore.hasDirty() &&
        !window.confirm(translateNow("remote.unsavedFileLeave"))
      )
        event.preventDefault();
    };
    const commitLeave = () => {
      leavingProject = true;
    };
    window.addEventListener("beforeunload", guard);
    window.addEventListener("idea:leave-remote-project", leaveProject);
    window.addEventListener("idea:remote-project-leaving", commitLeave);
    return () => {
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("idea:leave-remote-project", leaveProject);
      window.removeEventListener("idea:remote-project-leaving", commitLeave);
    };
  }, [fileEditStore]);
  const { t, locale } = useI18n();
  const pluginManagerRef = useRef<PluginManager>(new PluginManager());
  const completionAudioContextRef = useRef<AudioContext | null>(null);
  const completionAudioUnlockedRef = useRef(false);
  const managedRootIdsRef = useRef<Set<string>>(new Set());
  const expandedRef = useRef<string[]>([]);
  const selectedDirRef = useRef<string | null>(null);
  const fileRef = useRef<FilePayload | null>(null);
  const selectedSessionRef = useRef<SessionItem | null>(null);
  const lastMainSessionSnapshotRef = useRef<Session | null>(null);
  const sessionSearchTargetCounterRef = useRef(0);
  const currentSessionRef = useRef<SessionItem | null>(null);
  const interactionModeRef = useRef<"main" | "drawer">("main");
  const pendingDraftRef = useRef<PendingSend | null>(null);
  const pendingBySessionRef = useRef<Record<string, PendingSend>>({});
  const pendingRequestRef = useRef<Record<string, PendingSend>>({});
  const queuedMessagesBySessionRef = useRef<Record<string, SessionQueueItem[]>>(
    {},
  );
  const queueFrozenBySessionRef = useRef<Record<string, boolean>>({});
  const optimisticDequeuedIdsRef = useRef<Record<string, Set<string>>>({});
  const cancelRequestedBySessionRef = useRef<Record<string, boolean>>({});
  const sessionCacheRef = useRef<Record<string, Session>>({});
  const loadedSessionRef = useRef<Record<string, boolean>>({});
  const loadingSessionRef = useRef<
    Partial<Record<string, Promise<SyncSessionResult>>>
  >({});
  const staleSessionKeysRef = useRef<Set<string>>(new Set());
  const invalidTreeCacheKeysRef = useRef<Set<string>>(new Set());
  const boundSessionByRootRef = useRef<Record<string, string | null>>({});
  const suppressedAutoBindSessionByRootRef = useRef<
    Record<string, string | null>
  >({});
  const drawerSessionByRootRef = useRef<Record<string, SessionItem | null>>({});
  const selectedSessionByRootRef = useRef<Record<string, string | null>>({});
  const mainViewPreferenceByRootRef = useRef<
    Record<string, "session" | "file" | "directory" | "git-diff">
  >({});
  const drawerOpenByRootRef = useRef<Record<string, boolean>>({});
  const fileCursorRef = useRef<number>(0);
  const fileScrollPositionsRef = useRef<Record<string, number>>(
    loadPersistedFileScrollPositions(),
  );
  const pluginContentRef = useRef<HTMLDivElement | null>(null);
  const lastPluginChapterRef = useRef<string>("");
  const viewerSelectionRef = useRef<ViewerSelection | null>(null);
  const lastViewerSelectionRef = useRef<ViewerSelection | null>(null);
  const dismissedSelectionFileRef = useRef<string | null>(null);
  const lastPluginResetFileKeyRef = useRef<string>("");
  const pluginBypassRef = useRef<boolean>(false);
  const fileOpenRequestRef = useRef(0);
  const fullUpgradeAttemptRef = useRef("");
  const pluginsLoadedByRootRef = useRef<Record<string, boolean>>({});
  const pluginsLoadingByRootRef = useRef<Record<string, Promise<void>>>({});
  const pluginsTrustPendingByRootRef = useRef<Record<string, boolean>>({});
  const didInitRef = useRef(false);
  const relayWSAuthCheckRef = useRef(false);
  const managedRootsRequestRef = useRef<Promise<
    ManagedRootPayload[] | null
  > | null>(null);
  const handleSelectSessionRef = useRef<
    ((session: Partial<SessionItem> | null) => Promise<void>) | null
  >(null);

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const sessionsRef = useRef<SessionItem[]>([]);
  const [multiProjectSessionsEnabled, setMultiProjectSessionsEnabled] =
    useState(() => {
      if (typeof window === "undefined") return false;
      return (
        projectStorage().getItem(MULTI_PROJECT_SESSION_STORAGE_KEY) === "1"
      );
    });
  const [multiProjectSessionGroups, setMultiProjectSessionGroups] = useState<
    MultiProjectSessionGroup[]
  >([]);
  const [multiProjectSessionsLoading, setMultiProjectSessionsLoading] =
    useState(false);
  const [multiProjectPendingByKey, setMultiProjectPendingByKey] = useState<
    Record<string, boolean>
  >({});
  const multiProjectPendingRef = useRef<Record<string, boolean>>({});
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchResultsMode, setSessionSearchResultsMode] =
    useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [sessionSearchAppliedQuery, setSessionSearchAppliedQuery] =
    useState("");
  const [sessionSearchResults, setSessionSearchResults] = useState<
    SessionItem[]
  >([]);
  const [sessionSearchLoading, setSessionSearchLoading] = useState(false);
  const [syncingSessionKeys, setSyncingSessionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [loadingOlderSessions, setLoadingOlderSessions] = useState(false);
  const [sessionListMode, setSessionListMode] = useState<"local" | "import">(
    "local",
  );
  const sessionListModeRef = useRef<"local" | "import">("local");
  const [externalSessions, setExternalSessions] = useState<SessionItem[]>([]);
  const externalSessionsRef = useRef<SessionItem[]>([]);
  const [hasMoreExternalSessions, setHasMoreExternalSessions] = useState(false);
  const [loadingOlderExternalSessions, setLoadingOlderExternalSessions] =
    useState(false);
  const [loadingExternalSessions, setLoadingExternalSessions] = useState(false);
  const [externalSessionsError, setExternalSessionsError] = useState("");
  const [externalSelectedKey, setExternalSelectedKey] = useState("");
  const [externalImportAgent, setExternalImportAgent] = useState("");
  const externalImportAgentRef = useRef("");
  const [externalFilterBound, setExternalFilterBound] = useState(true);
  const [selectedExternalImportKeys, setSelectedExternalImportKeys] = useState<
    Set<string>
  >(() => new Set());
  const [importingExternalSessionKeys, setImportingExternalSessionKeys] =
    useState<Set<string>>(() => new Set());
  const [confirmingExternalImport, setConfirmingExternalImport] =
    useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement | null>(null);

  const [availableAgents, setAvailableAgents] = useState<AgentStatus[]>([]);
  const [scheduledAgentDialogOpen, setScheduledAgentDialogOpen] =
    useState(false);

  const [directoryUploadProgress, setDirectoryUploadProgress] =
    useState<UploadProgress | null>(null);

  const directoryUploadAbortRef = useRef<AbortController | null>(null);

  const knownWorktreePathsRef = useRef<Set<string>>(new Set());
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(
    null,
  );
  const [openSessionTabsByRoot, setOpenSessionTabsByRoot] = useState<
    Record<string, OpenSessionTab[]>
  >({});
  const [selectedSessionLoading, setSelectedSessionLoading] = useState(false);
  const [drawerLoadingSessionByRoot, setDrawerLoadingSessionByRoot] = useState<
    Record<string, string>
  >({});
  const [activeBoundSessionKey, setActiveBoundSessionKey] = useState<
    string | null
  >(null);
  const [pendingPlanMode, setPendingPlanMode] = useState(false);
  const [currentSession, setCurrentSession] = useState<SessionItem | null>(
    null,
  );
  const [cacheVersion, setCacheVersion] = useState(0);
  const [slashCommandResults, setSlashCommandResults] = useState<
    Record<string, SlashCommandResult>
  >({});
  const [copiedSlashCommandKeys, setCopiedSlashCommandKeys] = useState<
    Record<string, true>
  >({});
  const slashCopyResetTimersRef = useRef<Record<string, number>>({});
  const [queueVersion, setQueueVersion] = useState(0);
  const [interactionMode, setInteractionMode] = useState<"main" | "drawer">(
    "main",
  );
  const [agentsVersion, setAgentsVersion] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { isMobile } = useResponsive();
  const [sidebarsSwapped, setSidebarsSwapped] = useState(loadSidebarsSwapped);
  const [gitDiffSideBySide, setGitDiffSideBySide] = useState(
    loadGitDiffSideBySide,
  );
  const [isLeftOpen, setIsLeftOpen] = useState(
    () => !isIdeaRuntime && window.innerWidth >= 768,
  );

  const [isRightOpen, setIsRightOpen] = useState(
    () => !isIdeaRuntime && window.innerWidth >= 768,
  );

  const [currentRootId, setCurrentRootId] = useState<string | null>(null);
  const currentRootIdRef = useRef<string | null>(null);

  async function refreshRelatedWorktree(
    rootId: string,
    worktreePath: string,
    force = true,
  ) {
    const normalizedRootId = String(rootId || "").trim();
    const normalizedWorktreePath = String(worktreePath || "").trim();
    if (!normalizedRootId || !normalizedWorktreePath) {
      return;
    }
    if (!force && knownWorktreePathsRef.current.has(normalizedWorktreePath)) {
      return;
    }
    knownWorktreePathsRef.current.add(normalizedWorktreePath);
    setExpandedWorktreeByRoot((prev) => ({
      ...prev,
      [normalizedRootId]: normalizedWorktreePath,
    }));
    setWorktreeLoadingByRoot((prev) => ({ ...prev, [normalizedRootId]: true }));
    setWorktreeErrorByRoot((prev) => ({ ...prev, [normalizedRootId]: "" }));
    try {
      const payload = await fetchGitWorktrees(normalizedRootId);
      (payload.items || []).forEach((item) => {
        if (item.path) {
          knownWorktreePathsRef.current.add(item.path);
        }
      });
      setWorktreeItemsByRoot((prev) => ({
        ...prev,
        [normalizedRootId]: (payload.items || []).filter(
          (item) => !!item.branch,
        ),
      }));
    } catch (error) {
      knownWorktreePathsRef.current.delete(normalizedWorktreePath);
      setWorktreeErrorByRoot((prev) => ({
        ...prev,
        [normalizedRootId]:
          error instanceof Error ? error.message : t("worktree.loadFailed"),
      }));
    } finally {
      setWorktreeLoadingByRoot((prev) => ({
        ...prev,
        [normalizedRootId]: false,
      }));
    }
    setWorktreeStatusLoadingByPath((prev) => ({
      ...prev,
      [normalizedWorktreePath]: true,
    }));
    try {
      const status = await fetchGitStatusByPath(normalizedWorktreePath);
      setWorktreeStatusByPath((prev) => ({
        ...prev,
        [normalizedWorktreePath]: status,
      }));
    } catch {
      setWorktreeStatusByPath((prev) => ({
        ...prev,
        [normalizedWorktreePath]: null,
      }));
    } finally {
      setWorktreeStatusLoadingByPath((prev) => ({
        ...prev,
        [normalizedWorktreePath]: false,
      }));
    }
  }

  useEffect(() => {
    return () => {
      Object.values(slashCopyResetTimersRef.current).forEach((timer) =>
        window.clearTimeout(timer),
      );
      slashCopyResetTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    try {
      projectStorage().setItem(
        SIDEBARS_SWAPPED_STORAGE_KEY,
        sidebarsSwapped ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the setting can still apply for this session.
    }
  }, [sidebarsSwapped]);

  useEffect(() => {
    try {
      projectStorage().setItem(
        GIT_DIFF_SIDE_BY_SIDE_STORAGE_KEY,
        gitDiffSideBySide ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the setting can still apply for this session.
    }
  }, [gitDiffSideBySide]);

  const [managedRootIds, setManagedRootIds] = useState<string[]>([]);
  const managedRootByIdRef = useRef<Record<string, ManagedRootPayload>>({});
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);

  const [relayStatus, setRelayStatus] = useState<RelayStatusPayload | null>(
    null,
  );

  const [bootstrapState, setBootstrapState] = useState<BootstrapState>(() =>
    bootstrapService.snapshot(),
  );
  const [e2eeState, setE2eeState] = useState<E2EEState>(() =>
    e2eeService.snapshot(),
  );

  const [editDraftRequest, setEditDraftRequest] = useState<{
    id: number;
    content: string;
  } | null>(null);
  const [entriesByPath, setEntriesByPath] = useState<
    Record<string, FileEntry[]>
  >({});
  const entriesByPathRef = useRef<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [selectedDirKey, setSelectedDirKey] = useState<string | null>(null);
  const [mainEntries, setMainEntries] = useState<FileEntry[]>([]);
  const [mainDirectoryError, setMainDirectoryError] = useState("");

  const [gitStatusExpandedByRoot, setGitStatusExpandedByRoot] = useState<
    Record<string, boolean>
  >(() => loadBooleanRecord(GIT_STATUS_EXPANDED_STORAGE_KEY));
  const [gitHistoryExpandedByRoot, setGitHistoryExpandedByRoot] = useState<
    Record<string, Record<string, boolean>>
  >(() => loadStringBooleanRecord(GIT_HISTORY_EXPANDED_STORAGE_KEY));

  const [relatedSelectedFileKey, setRelatedSelectedFileKey] = useState("");
  const [treeSortMode, setTreeSortMode] = useState<DirectorySortMode>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_DIRECTORY_SORT_MODE;
    }
    const saved = projectStorage().getItem(TREE_SORT_STORAGE_KEY);
    return isDirectorySortMode(saved) ? saved : DEFAULT_DIRECTORY_SORT_MODE;
  });
  const [directorySortOverrides, setDirectorySortOverrides] = useState<
    Record<string, DirectorySortMode>
  >(() => {
    if (typeof window === "undefined") {
      return {};
    }
    try {
      const saved = projectStorage().getItem(
        DIRECTORY_SORT_OVERRIDES_STORAGE_KEY,
      );
      if (!saved) {
        return {};
      }
      const parsed = JSON.parse(saved) as Record<string, string>;
      return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) =>
          isDirectorySortMode(value),
        ),
      ) as Record<string, DirectorySortMode>;
    } catch {
      return {};
    }
  });

  const [status, setStatus] = useState<WSStatus>("disconnected");
  const [file, setFile] = useState<FilePayload | null>(null);
  const [viewerSelection, setViewerSelection] =
    useState<ViewerSelection | null>(null);
  const [attachedFileContext, setAttachedFileContext] =
    useState<AttachedFileContext | null>(null);
  const [pluginVersion, setPluginVersion] = useState(0);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pendingPluginTrust, setPendingPluginTrust] = useState<{
    rootId: string;
    bundle: PluginSourceBundle;
  } | null>(null);
  const [pluginBypass, setPluginBypass] = useState(false);
  const [pluginQuery, setPluginQuery] = useState<Record<string, string>>(
    () => readURLState().pluginQuery,
  );
  const pluginQueryRef = useRef<Record<string, string>>(
    readURLState().pluginQuery,
  );
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [projectTreeTabRequest, setProjectTreeTabRequest] = useState<{
    tab: ProjectTreeTab;
    nonce: number;
  } | null>(null);
  const [projectTreeTab, setProjectTreeTab] = useState<ProjectTreeTab>("files");
  const [worktreeItemsByRoot, setWorktreeItemsByRoot] = useState<
    Record<string, GitWorktreeItem[]>
  >({});
  const [worktreeLoadingByRoot, setWorktreeLoadingByRoot] = useState<
    Record<string, boolean>
  >({});
  const [worktreeErrorByRoot, setWorktreeErrorByRoot] = useState<
    Record<string, string>
  >({});
  const [expandedWorktreeByRoot, setExpandedWorktreeByRoot] = useState<
    Record<string, string>
  >({});
  const [worktreeStatusByPath, setWorktreeStatusByPath] = useState<
    Record<string, GitStatusPayload | null>
  >({});
  const [worktreeStatusLoadingByPath, setWorktreeStatusLoadingByPath] =
    useState<Record<string, boolean>>({});
  const [updateState, setUpdateState] = useState<UpdateState>(() =>
    normalizeUpdateState(null),
  );
  const [updateSubmitting, setUpdateSubmitting] = useState(false);

  const ensureCompletionAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") {
      return null;
    }
    const AudioContextCtor =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    if (!completionAudioContextRef.current) {
      completionAudioContextRef.current = new AudioContextCtor();
    }
    return completionAudioContextRef.current;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const unlockAudio = () => {
      const audioContext = ensureCompletionAudioContext();
      if (!audioContext) {
        return;
      }
      if (audioContext.state === "running") {
        completionAudioUnlockedRef.current = true;
        return;
      }
      void audioContext
        .resume()
        .then(() => {
          completionAudioUnlockedRef.current = audioContext.state === "running";
        })
        .catch(() => {});
    };
    const options: AddEventListenerOptions = { passive: true };
    window.addEventListener("pointerdown", unlockAudio, options);
    window.addEventListener("keydown", unlockAudio, options);
    window.addEventListener("touchstart", unlockAudio, options);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, [ensureCompletionAudioContext]);

  const handleStartUpdate = useCallback(async () => {
    const next = normalizeUpdateState(updateState);
    const status = (next.status || "idle").toLowerCase();
    if (
      status === "downloading" ||
      status === "installing" ||
      status === "restarting"
    ) {
      return;
    }
    if (next.has_update && status === "available") {
      const target = next.latest_version
        ? `v${next.latest_version}`
        : "the latest version";
      if (
        !window.confirm(
          `Install ${target} now? MindFS will restart after the update finishes.`,
        )
      ) {
        return;
      }
    }
    setUpdateSubmitting(true);
    try {
      await scheduleWebViewCacheClearOnNextLaunch();
      setUpdateState(normalizeUpdateState(await triggerUpdate()));
    } catch (error) {
      await cancelScheduledWebViewCacheClear();
      const message =
        error instanceof Error ? error.message : "Failed to start update";
      setUpdateState((prev) =>
        normalizeUpdateState({
          ...prev,
          status: "failed",
          message,
        }),
      );
    } finally {
      setUpdateSubmitting(false);
    }
  }, [updateState]);

  const playCompletionSound = useCallback(() => {
    const audioContext = ensureCompletionAudioContext();
    if (!audioContext) {
      return;
    }
    try {
      if (audioContext.state !== "running") {
        return;
      }
      completionAudioUnlockedRef.current = true;
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.frequency.exponentialRampToValueAtTime(1174, now + 0.09);
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.24, now + 0.012);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch (error) {
      if (completionAudioUnlockedRef.current) {
        console.error("Failed to play completion sound:", error);
      }
    }
  }, [ensureCompletionAudioContext]);

  useEffect(() => {
    currentRootIdRef.current = currentRootId;
  }, [currentRootId]);
  useEffect(() => {
    let cancelled = false;
    if (!e2eeState.configured || (e2eeState.required && !e2eeState.unlocked)) {
      return;
    }
    fetchAgents(true)
      .then((items) => {
        if (cancelled) return;
        setAvailableAgents(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    agentsVersion,
    e2eeState.configured,
    e2eeState.required,
    e2eeState.unlocked,
  ]);
  useEffect(() => {
    if (!importMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) {
        setImportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [importMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (currentRootId) {
      projectStorage().setItem(LAST_ROOT_STORAGE_KEY, currentRootId);
    }
  }, [currentRootId]);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  useEffect(() => {
    selectedDirRef.current = selectedDir;
  }, [selectedDir]);
  useEffect(() => {
    entriesByPathRef.current = entriesByPath;
  }, [entriesByPath]);
  useEffect(() => {
    fileRef.current = file;
  }, [file]);
  useEffect(() => {
    viewerSelectionRef.current = viewerSelection;
  }, [viewerSelection]);
  useEffect(() => {
    pluginQueryRef.current = pluginQuery;
  }, [pluginQuery]);
  useEffect(() => {
    if (!file?.path || !currentRootId) return;
    const nextKey = `${currentRootId}:${file.path}`;
    if (lastPluginResetFileKeyRef.current !== nextKey) {
      pluginBypassRef.current = false;
      setPluginBypass(false);
      lastPluginResetFileKeyRef.current = nextKey;
    }
  }, [file?.path, currentRootId]);
  useEffect(() => {
    pluginBypassRef.current = pluginBypass;
  }, [pluginBypass]);
  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);
  useEffect(() => {
    if (
      selectedSession ||
      activeBoundSessionKey ||
      interactionMode !== "main"
    ) {
      setPendingPlanMode(false);
    }
  }, [selectedSession, activeBoundSessionKey, interactionMode]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    multiProjectPendingRef.current = multiProjectPendingByKey;
  }, [multiProjectPendingByKey]);
  useEffect(() => {
    projectStorage().setItem(
      MULTI_PROJECT_SESSION_STORAGE_KEY,
      multiProjectSessionsEnabled ? "1" : "0",
    );
  }, [multiProjectSessionsEnabled]);
  useEffect(() => {
    sessionListModeRef.current = sessionListMode;
    if (sessionListMode !== "local") {
      setSessionSearchOpen(false);
      setSessionSearchResultsMode(false);
      setSessionSearchQuery("");
      setSessionSearchAppliedQuery("");
      setSessionSearchResults([]);
      setSessionSearchLoading(false);
    }
  }, [sessionListMode]);
  useEffect(() => {
    setSessionSearchQuery("");
    setSessionSearchResultsMode(false);
    setSessionSearchAppliedQuery("");
    setSessionSearchResults([]);
    setSessionSearchLoading(false);
  }, [currentRootId]);
  useEffect(() => {
    setPendingPlanMode(false);
  }, [currentRootId]);
  useEffect(() => {
    externalSessionsRef.current = externalSessions;
  }, [externalSessions]);
  useEffect(() => {
    externalImportAgentRef.current = externalImportAgent;
  }, [externalImportAgent]);
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);
  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    projectStorage().setItem(TREE_SORT_STORAGE_KEY, treeSortMode);
  }, [treeSortMode]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    projectStorage().setItem(
      GIT_STATUS_EXPANDED_STORAGE_KEY,
      JSON.stringify(gitStatusExpandedByRoot),
    );
  }, [gitStatusExpandedByRoot]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    projectStorage().setItem(
      GIT_HISTORY_EXPANDED_STORAGE_KEY,
      JSON.stringify(gitHistoryExpandedByRoot),
    );
  }, [gitHistoryExpandedByRoot]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    projectStorage().setItem(
      DIRECTORY_SORT_OVERRIDES_STORAGE_KEY,
      JSON.stringify(directorySortOverrides),
    );
  }, [directorySortOverrides]);

  useEffect(() => {
    const rootID = currentRootId;
    if (!rootID) return;
    setActiveBoundSessionKey(boundSessionByRootRef.current[rootID] || null);
    setCurrentSession(drawerSessionByRootRef.current[rootID] || null);
    setIsDrawerOpen(!!drawerOpenByRootRef.current[rootID]);
  }, [currentRootId]);

  const setBoundSessionForRoot = useCallback(
    (rootID: string | null | undefined, key: string | null) => {
      if (!rootID) return;
      boundSessionByRootRef.current[rootID] = key;
      if (currentRootIdRef.current === rootID) {
        setActiveBoundSessionKey(key);
      }
    },
    [],
  );

  const setDrawerSessionForRoot = useCallback(
    (
      rootID: string | null | undefined,
      session: Session | SessionItem | null,
    ) => {
      if (!rootID) return;
      const next = toSessionItem(rootID, session);
      drawerSessionByRootRef.current[rootID] = next;
      if (currentRootIdRef.current === rootID) {
        setCurrentSession(next);
      }
    },
    [],
  );

  const setDrawerOpenForRoot = useCallback(
    (rootID: string | null | undefined, open: boolean) => {
      if (!rootID) return;
      drawerOpenByRootRef.current[rootID] = open;
      if (currentRootIdRef.current === rootID) {
        setIsDrawerOpen(open);
      }
    },
    [],
  );

  const setMainViewPreferenceForRoot = useCallback(
    (
      rootID: string | null | undefined,
      preference: "session" | "file" | "directory" | "git-diff",
    ) => {
      if (!rootID) return;
      mainViewPreferenceByRootRef.current[rootID] = preference;
    },
    [],
  );

  const getDirectorySortKey = useCallback(
    (rootID: string | null | undefined, dirPath: string | null | undefined) => {
      if (!rootID) {
        return "";
      }
      const normalizedDir = !dirPath || dirPath === rootID ? "." : dirPath;
      return `${rootID}:${normalizedDir}`;
    },
    [],
  );

  const currentDirectorySortKey = getDirectorySortKey(
    currentRootId,
    selectedDir,
  );
  const currentDirectorySortOverride = currentDirectorySortKey
    ? directorySortOverrides[currentDirectorySortKey]
    : undefined;

  const currentDirectorySortMode = currentDirectorySortOverride || treeSortMode;

  const replaceURLState = useCallback((next: URLState) => {
    const search = buildURLSearch(next);
    const target = `${window.location.pathname}${search}`;
    window.history.replaceState(null, "", target);
  }, []);

  const redirectToRelayLogin = useCallback(() => {
    const next = encodeURIComponent(
      `${window.location.pathname}${window.location.search}`,
    );
    window.location.replace(`/login?next=${next}`);
  }, []);

  const redirectToRelayNodes = useCallback(() => {
    window.location.replace("/nodes");
  }, []);

  const handleRelayWebSocketClosed = useCallback(async () => {
    if (!isRelayNodePage() || relayWSAuthCheckRef.current) {
      return;
    }
    relayWSAuthCheckRef.current = true;
    try {
      const response = await fetch("/api/auth/me", { cache: "no-cache" });
      if (!response.ok) {
        redirectToRelayLogin();
        return;
      }
      const nodeID = relayNodeIdFromPathname(window.location.pathname);
      if (!nodeID) {
        return;
      }
      const nodeResponse = await fetch(`/n/${encodeURIComponent(nodeID)}/`, {
        cache: "no-cache",
        headers: {
          Accept: "application/json",
        },
      });
      if (
        nodeResponse.status === 403 ||
        nodeResponse.status === 404 ||
        nodeResponse.status === 502 ||
        nodeResponse.status === 503
      ) {
        redirectToRelayNodes();
      }
    } catch {
      // Network failures and connector outages also close the socket. Keep the
      // normal reconnect path unless the auth probe can prove the session died.
    } finally {
      relayWSAuthCheckRef.current = false;
    }
  }, [redirectToRelayLogin, redirectToRelayNodes]);

  const handleRelayNavigationFailure = useCallback(
    async (status: number, errorCode?: string | null) => {
      if (!isRelayPWAContext()) {
        return false;
      }
      const code = String(errorCode || "").trim();
      if (status === 401 || code === "unauthorized") {
        try {
          const response = await fetch("/api/auth/me");
          if (response.ok) {
            return false;
          }
        } catch {}
        redirectToRelayLogin();
        return true;
      }
      if (
        status === 403 ||
        status === 404 ||
        status === 502 ||
        status === 503 ||
        code === "forbidden" ||
        code === "node_not_found" ||
        code === "node_offline" ||
        code === "connector_unavailable"
      ) {
        redirectToRelayNodes();
        return true;
      }
      return false;
    },
    [redirectToRelayLogin, redirectToRelayNodes],
  );

  const rootSessionKey = useCallback(
    (rootId: string, sessionKey: string) => `${rootId}::${sessionKey}`,
    [],
  );
  const openSessionTab = useCallback((rootID: string, session: SessionItem) => {
    const sessionKey = session?.key || session?.session_key;
    if (!rootID || !sessionKey) return;
    const normalized: OpenSessionTab = {
      key: sessionKey,
      session_key: sessionKey,
      root_id: rootID,
      name: session.name,
      title: session.title,
      agent: session.agent,
      type: session.type,
      pending: session.pending,
    };
    setOpenSessionTabsByRoot((prev) => {
      const current = prev[rootID] || [];
      const existingIndex = current.findIndex(
        (item) => (item.key || item.session_key) === sessionKey,
      );
      if (existingIndex < 0) {
        return { ...prev, [rootID]: [...current, normalized] };
      }
      const next = [...current];
      const existing = next[existingIndex];
      next[existingIndex] = {
        ...existing,
        ...normalized,
        name: normalized.name || existing.name,
        title: normalized.title || existing.title,
      };
      return { ...prev, [rootID]: next };
    });
  }, []);
  const removeSessionTabs = useCallback((rootID: string, keys: Set<string>) => {
    if (!rootID || keys.size === 0) return;
    setOpenSessionTabsByRoot((prev) => {
      const current = prev[rootID] || [];
      const nextTabs = current.filter(
        (item) => !keys.has(item.key || item.session_key || ""),
      );
      if (nextTabs.length === current.length) return prev;
      const next = { ...prev };
      if (nextTabs.length > 0) next[rootID] = nextTabs;
      else delete next[rootID];
      return next;
    });
  }, []);
  const bumpCacheVersion = useCallback(() => setCacheVersion((v) => v + 1), []);
  const clearRootScopedClientState = useCallback(
    (rootID: string, options?: { removeLastRoot?: boolean }) => {
      const root = String(rootID || "").trim();
      if (!root) {
        return;
      }
      const sessionPrefix = `${root}::`;
      const treePrefix = `${root}:`;

      const deleteRecordKeys = <T,>(
        record: Record<string, T>,
        predicate: (key: string) => boolean,
      ) => {
        for (const key of Object.keys(record)) {
          if (predicate(key)) {
            delete record[key];
          }
        }
      };
      const deleteSessionRecordKeys = <T,>(record: Record<string, T>) => {
        deleteRecordKeys(record, (key) => key.startsWith(sessionPrefix));
      };

      clearGitHistoryCache(root);
      clearFileCacheForRoot(root);
      void clearCachedSessionsForRoot(root);

      delete boundSessionByRootRef.current[root];
      delete suppressedAutoBindSessionByRootRef.current[root];
      delete drawerSessionByRootRef.current[root];
      delete selectedSessionByRootRef.current[root];
      delete mainViewPreferenceByRootRef.current[root];
      delete drawerOpenByRootRef.current[root];
      delete pluginsLoadedByRootRef.current[root];
      delete pluginsLoadingByRootRef.current[root];
      delete pluginsTrustPendingByRootRef.current[root];
      setOpenSessionTabsByRoot((prev) => {
        if (!(root in prev)) return prev;
        const next = { ...prev };
        delete next[root];
        return next;
      });

      deleteSessionRecordKeys(sessionCacheRef.current);
      deleteSessionRecordKeys(loadedSessionRef.current);
      deleteSessionRecordKeys(loadingSessionRef.current);
      deleteSessionRecordKeys(pendingBySessionRef.current);
      deleteSessionRecordKeys(queuedMessagesBySessionRef.current);
      deleteSessionRecordKeys(queueFrozenBySessionRef.current);
      deleteSessionRecordKeys(cancelRequestedBySessionRef.current);
      deleteSessionRecordKeys(pendingRequestRef.current);
      deleteRecordKeys(optimisticDequeuedIdsRef.current, (key) =>
        key.startsWith(sessionPrefix),
      );
      staleSessionKeysRef.current = new Set(
        Array.from(staleSessionKeysRef.current).filter(
          (key) => !key.startsWith(sessionPrefix),
        ),
      );

      deleteRecordKeys(
        entriesByPathRef.current,
        (key) => key === root || key.startsWith(treePrefix),
      );
      setEntriesByPath((prev) => {
        const next = { ...prev };
        deleteRecordKeys(
          next,
          (key) => key === root || key.startsWith(treePrefix),
        );
        return next;
      });
      invalidTreeCacheKeysRef.current = new Set(
        Array.from(invalidTreeCacheKeysRef.current).filter(
          (key) => key !== root && !key.startsWith(treePrefix),
        ),
      );

      setGitStatusExpandedByRoot((prev) => {
        if (!(root in prev)) return prev;
        const next = { ...prev };
        delete next[root];
        return next;
      });
      setGitHistoryExpandedByRoot((prev) => {
        if (!(root in prev)) return prev;
        const next = { ...prev };
        delete next[root];
        return next;
      });

      setDirectorySortOverrides((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key === root || key.startsWith(treePrefix)) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setMultiProjectPendingByKey((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(sessionPrefix)) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setMultiProjectSessionGroups((prev) => {
        const next = prev.filter((group) => group.rootId !== root);
        return next.length === prev.length ? prev : next;
      });
      multiProjectPendingRef.current = Object.fromEntries(
        Object.entries(multiProjectPendingRef.current).filter(
          ([key]) => !key.startsWith(sessionPrefix),
        ),
      );
      setSlashCommandResults((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(sessionPrefix)) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      deleteRecordKeys(fileScrollPositionsRef.current, (key) =>
        key.startsWith(sessionPrefix),
      );
      persistFileScrollPositions(fileScrollPositionsRef.current);
      removeLocalStorageByPrefix(`${PLUGIN_QUERY_STORAGE_PREFIX}${root}:`);
      if (
        options?.removeLastRoot === true &&
        typeof window !== "undefined" &&
        projectStorage().getItem(LAST_ROOT_STORAGE_KEY) === root
      ) {
        projectStorage().removeItem(LAST_ROOT_STORAGE_KEY);
      }

      bumpCacheVersion();
      setQueueVersion((value) => value + 1);
    },
    [bumpCacheVersion],
  );
  const clearSlashCommandResultForSession = useCallback(
    (rootID: string, sessionKey: string) => {
      const key = rootSessionKey(rootID, sessionKey);
      setSlashCommandResults((prev) => {
        if (!prev[key]) {
          return prev;
        }
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [rootSessionKey],
  );
  const applyPendingToMultiProjectGroups = useCallback(
    (
      groups: MultiProjectSessionGroup[],
      pendingByKey: Record<string, boolean>,
    ) =>
      groups.map((group) => ({
        ...group,
        sessions: group.sessions.map(
          (session) =>
            ({
              ...(session as any),
              pending:
                !!pendingByKey[
                  rootSessionKey(
                    group.rootId,
                    session.key || session.session_key,
                  )
                ],
            }) as SessionItem,
        ),
      })),
    [rootSessionKey],
  );
  const setMultiProjectSessionPending = useCallback(
    (
      rootID: string | null | undefined,
      sessionKey: string | null | undefined,
      pending: boolean,
    ) => {
      const resolvedRoot = String(rootID || "");
      const resolvedKey = String(sessionKey || "");
      if (!resolvedRoot || !resolvedKey) {
        return;
      }
      const key = rootSessionKey(resolvedRoot, resolvedKey);
      setMultiProjectPendingByKey((prev) => {
        const next = { ...prev };
        if (pending) {
          next[key] = true;
        } else {
          delete next[key];
        }
        multiProjectPendingRef.current = next;
        setMultiProjectSessionGroups((groups) =>
          applyPendingToMultiProjectGroups(groups, next),
        );
        return next;
      });
    },
    [applyPendingToMultiProjectGroups, rootSessionKey],
  );
  const resolveRootForSessionKey = useCallback(
    (sessionKey: string): string | null => {
      if (!sessionKey) return null;
      const currentRoot = currentRootIdRef.current;
      if (
        currentRoot &&
        sessionCacheRef.current[rootSessionKey(currentRoot, sessionKey)]
      ) {
        return currentRoot;
      }
      for (const [rootID, key] of Object.entries(
        boundSessionByRootRef.current,
      )) {
        if (key === sessionKey) {
          return rootID;
        }
      }
      for (const [rootID, session] of Object.entries(
        drawerSessionByRootRef.current,
      )) {
        if (session?.key === sessionKey) {
          return rootID;
        }
      }
      const suffix = `::${sessionKey}`;
      const matched = Object.keys(sessionCacheRef.current).find((key) =>
        key.endsWith(suffix),
      );
      if (!matched) return null;
      return matched.slice(0, matched.length - suffix.length);
    },
    [rootSessionKey],
  );
  const {
    getSessionSnapshot,
    setSelectedPendingByKey,
    resolvePendingForSession,
    clearLocalPendingForSession,
    markSessionStale,
    clearSessionStale,
    isSessionStale,
    restoreActiveSession,
    updateSessionRelatedFilesForKey,
    updateSessionRelatedWorktreeForKey,
    updateSessionAgentForKey,
    handleSetPlanMode,
    promotePendingSessionForRoot,
    appendAgentChunkForSession,
    appendThoughtChunkForSession,
    appendToolCallForSession,
    appendTodoUpdateForSession,
    appendPlanUpdateForSession,
    appendCompactNoticeForSession,
    attachContextWindowToLatestAssistant,
  } = useSessionCache({
    rootSessionKey,
    sessionCacheRef,
    drawerSessionByRootRef,
    cacheVersion,
    setSelectedSession,
    pendingBySessionRef,
    selectedSessionRef,
    currentRootIdRef,
    setDrawerSessionForRoot,
    setSessions,
    setMultiProjectSessionPending,
    bumpCacheVersion,
    staleSessionKeysRef,
    loadingSessionRef,
    lastMainSessionSnapshotRef,
    sessions,
    currentSessionRef,
    t,
    setPendingPlanMode,
    loadedSessionRef,
    boundSessionByRootRef,
    setBoundSessionForRoot,
    selectedSessionByRootRef,
    setOpenSessionTabsByRoot,
  });

  const normalizeTreeResponse = useCallback((payload: any) => {
    if (payload && payload.entries)
      return { entries: payload.entries as FileEntry[] };
    return { entries: [] };
  }, []);

  const formatDirectoryLoadError = useCallback(
    (message?: string | null) => {
      const text = String(message || "").trim();
      if (!text) {
        return t("directory.readFailed");
      }
      const lower = text.toLowerCase();
      if (
        lower.includes("access is denied") ||
        lower.includes("permission denied") ||
        lower.includes("operation not permitted") ||
        lower.includes("拒绝访问") ||
        lower.includes("权限")
      ) {
        return t("directory.permissionDenied");
      }
      return text;
    },
    [t],
  );

  const treeCacheKey = useCallback(
    (rootID: string, dirPath: string) => `${rootID}:${dirPath || "."}`,
    [],
  );

  const refreshTreeDir = useCallback(
    async (rootID: string, dirPath: string, syncMain: boolean) => {
      try {
        const payload = await apiProtectedJSON<any>(
          appURL(
            "/api/tree",
            new URLSearchParams({ root: rootID, dir: dirPath }),
          ),
        );
        const parsed = normalizeTreeResponse(payload);
        invalidTreeCacheKeysRef.current.delete(treeCacheKey(rootID, dirPath));
        setMainDirectoryError("");
        setEntriesByPath((prev) => ({
          ...prev,
          [treeCacheKey(rootID, dirPath)]: parsed.entries,
        }));
        if (syncMain) {
          setMainEntries(parsed.entries);
        }
      } catch {}
    },
    [normalizeTreeResponse, treeCacheKey],
  );

  const refreshCurrentFileContent = useCallback(
    async (rootID: string, changedPath: string) => {
      const currentFile = fileRef.current;
      if (!currentFile) return;
      const currentRoot = currentFile.root || currentRootIdRef.current || "";
      if (currentRoot !== rootID || currentFile.path !== changedPath) return;

      let readMode: "incremental" | "full" = "incremental";
      if (!pluginBypassRef.current) {
        try {
          const plugin = pluginManagerRef.current.match(
            rootID,
            buildMatchInputFromPath(changedPath, pluginQueryRef.current),
          );
          readMode = inferReadModeFromPlugin(plugin);
        } catch {
          readMode = "incremental";
        }
      }

      try {
        const next = await fetchFile({
          rootId: rootID,
          path: changedPath,
          readMode,
          cursor: fileCursorRef.current || 0,
        });
        const latestFile = fileRef.current;
        const latestRoot = latestFile?.root || currentRootIdRef.current || "";
        if (
          !next ||
          !latestFile ||
          latestRoot !== rootID ||
          latestFile.path !== changedPath
        ) {
          return;
        }
        setFile({
          ...next,
          targetLine: latestFile.targetLine,
          targetColumn: latestFile.targetColumn,
        });
      } catch (err) {
        console.error("[file.refresh.changed] failed", {
          rootID,
          changedPath,
          err,
        });
      }
    },
    [],
  );
  const {
    gitStatus,
    setGitStatus,
    gitStatusLoading,
    gitHistory,
    setGitHistory,
    gitHistoryLoading,
    gitHistoryLoadingMore,
    gitStatusByRoot,
    gitStatusLoadingByRoot,
    gitHistoryByRoot,
    gitHistoryLoadingByRoot,
    gitDiff,
    setGitDiff,
    refreshGitStatus,
    refreshGitHistory,
    loadMoreGitHistory,
    openGitDiff,
    openGitCommitDiff,
    switchGitBranch,
    handleGitPull,
    handleGitPush,
    handleGitCommit,
    handleGitStageItem,
    handleGitUnstageItem,
    handleGitDiscardItem,
  } = useWorkspaceGit({
    currentRootIdRef,
    managedRootByIdRef,
    fileOpenRequestRef,
    setRelatedSelectedFileKey,
    setMainViewPreferenceForRoot,
    setSelectedSession,
    setSelectedSessionLoading,
    setFile,
    replaceURLState,
    setCurrentRootId,
    isMobile,
    setIsLeftOpen,
    refreshTreeDir,
    selectedDirRef,
    t,
  });

  const loadSessionsForRoot = useCallback(
    async (
      rootID: string,
      options?: {
        beforeTime?: string;
        afterTime?: string;
        replace?: boolean;
        force?: boolean;
      },
    ) => {
      try {
        const shouldReplace =
          options?.replace || (!options?.beforeTime && !options?.afterTime);
        if (shouldReplace) {
          const cached = await getCachedSessionList(rootID);
          if (
            cached &&
            (options?.force || currentRootIdRef.current === rootID)
          ) {
            const cachedItems = [...cached.items, ...cached.pinnedItems]
              .map((item) => toSessionItem(rootID, item))
              .filter((item): item is SessionItem => !!item);
            setHasMoreSessions(cached.totalCount > cached.items.length);
            setSessions(
              applyPinnedSnapshotToSessions(
                mergeSessionItems([], cachedItems),
                rootID,
                cached.pinnedKeys,
              ),
            );
          }
        }
        const payload = await sessionService.fetchSessions(rootID, {
          beforeTime: options?.beforeTime,
          afterTime: options?.afterTime,
        });
        const next = [...payload.items, ...payload.pinnedItems]
          .map((item) => toSessionItem(rootID, item))
          .filter((item): item is SessionItem => !!item);
        if (!options?.force && currentRootIdRef.current !== rootID) return;
        setHasMoreSessions(payload.totalCount > payload.items.length);
        if (shouldReplace) {
          setSessions(
            applyPinnedSnapshotToSessions(
              mergeSessionItems([], next),
              rootID,
              payload.pinnedKeys,
            ),
          );
          void saveCachedSessionList(rootID, payload);
          return;
        }
        setSessions((prev) =>
          applyPinnedSnapshotToSessions(
            mergeSessionItems(prev, next),
            rootID,
            payload.pinnedKeys,
          ),
        );
      } catch {}
    },
    [],
  );

  const loadChildSessionsForParent = useCallback(
    async (
      parent: SessionItem,
      options?: { beforeTime?: string },
    ): Promise<{ hasMore: boolean }> => {
      const rootID =
        (parent.root_id as string | undefined) ||
        currentRootIdRef.current ||
        "";
      const parentKey = parent.key || parent.session_key || "";
      if (!rootID || !parentKey) {
        return { hasMore: false };
      }
      const items = await sessionService.fetchChildSessions(rootID, parentKey, {
        beforeTime: options?.beforeTime,
        limit: CHILD_SESSION_PAGE_SIZE,
      });
      const next = items
        .map((item) => toSessionItem(rootID, item))
        .filter((item): item is SessionItem => !!item);
      if (currentRootIdRef.current === rootID && next.length > 0) {
        setSessions((prev) => mergeSessionItems(prev, next));
      }
      if (next.length > 0) {
        setMultiProjectSessionGroups((prev) =>
          applyPendingToMultiProjectGroups(
            prev.map((group) =>
              group.rootId === rootID
                ? {
                    ...group,
                    sessions: mergeSessionItems(group.sessions, next),
                  }
                : group,
            ),
            multiProjectPendingRef.current,
          ),
        );
      }
      return { hasMore: items.length >= CHILD_SESSION_PAGE_SIZE };
    },
    [applyPendingToMultiProjectGroups, mergeSessionItems],
  );

  const loadMultiProjectSessionGroups = useCallback(async () => {
    if (!multiProjectSessionsEnabled || !protectedAPIReady()) {
      return;
    }
    setMultiProjectSessionsLoading(true);
    try {
      const cachedGroups = await getCachedMultiRootSessionList();
      if (cachedGroups?.length) {
        setMultiProjectSessionGroups(
          applyPendingToMultiProjectGroups(
            cachedGroups.map(
              (group): MultiProjectSessionGroup => ({
                rootId: group.rootId,
                rootName:
                  group.rootName ||
                  managedRootByIdRef.current[group.rootId]?.display_name ||
                  group.rootId,
                latestSessionTime: group.latestSessionTime,
                sessions: applyPinnedSnapshotToSessions(
                  mergeSessionItems(
                    [],
                    [...group.items, ...group.pinnedItems]
                      .map((item) =>
                        toSessionItem(group.rootId, {
                          ...(item as any),
                          root_id: group.rootId,
                        }),
                      )
                      .filter((item): item is SessionItem => !!item),
                  ),
                  group.rootId,
                  group.pinnedKeys,
                ),
                totalCount: group.totalCount,
              }),
            ),
            multiProjectPendingRef.current,
          ),
        );
      }
      const groups = await sessionService.fetchMultiRootSessions(
        MULTI_PROJECT_SESSION_LIMIT,
      );
      const nextGroups = groups.map(
        (group: MultiRootSessionGroup): MultiProjectSessionGroup => ({
          rootId: group.rootId,
          rootName:
            group.rootName ||
            managedRootByIdRef.current[group.rootId]?.display_name ||
            group.rootId,
          latestSessionTime: group.latestSessionTime,
          sessions: applyPinnedSnapshotToSessions(
            mergeSessionItems(
              [],
              [...group.items, ...group.pinnedItems]
                .map((item) =>
                  toSessionItem(group.rootId, {
                    ...(item as any),
                    root_id: group.rootId,
                  }),
                )
                .filter((item): item is SessionItem => !!item),
            ),
            group.rootId,
            group.pinnedKeys,
          ).filter((item): item is SessionItem => !!item),
          totalCount: group.totalCount,
        }),
      );
      setMultiProjectSessionGroups(
        applyPendingToMultiProjectGroups(
          nextGroups,
          multiProjectPendingRef.current,
        ),
      );
      void saveCachedMultiRootSessionList(groups);
    } finally {
      setMultiProjectSessionsLoading(false);
    }
  }, [applyPendingToMultiProjectGroups, multiProjectSessionsEnabled]);

  const loadMoreMultiProjectSessions = useCallback(
    async (group: ProjectSessionGroup) => {
      const topLevelSessions = group.sessions.filter(isTopLevelSessionItem);
      const oldest =
        topLevelSessions[topLevelSessions.length - 1]?.updated_at || "";
      if (!group.rootId || !oldest) {
        return;
      }
      const previousLoaded = topLevelSessions.length;
      const payload = await sessionService.fetchSessions(group.rootId, {
        beforeTime: oldest,
        limit: SESSION_PAGE_SIZE,
        topLevel: true,
        includeChildren: true,
      });
      const nextItems = payload.items
        .concat(payload.pinnedItems)
        .map((item) =>
          toSessionItem(group.rootId, {
            ...(item as any),
            root_id: group.rootId,
          }),
        )
        .filter((item): item is SessionItem => !!item);
      setMultiProjectSessionGroups((prev) =>
        applyPendingToMultiProjectGroups(
          prev.map((current) => {
            if (current.rootId !== group.rootId) {
              return current;
            }
            const sessions = applyPinnedSnapshotToSessions(
              mergeSessionItems(current.sessions, nextItems),
              group.rootId,
              payload.pinnedKeys,
            );
            return {
              ...current,
              sessions,
              totalCount: previousLoaded + payload.totalCount,
            };
          }),
          multiProjectPendingRef.current,
        ),
      );
    },
    [applyPendingToMultiProjectGroups, mergeSessionItems],
  );

  const refreshMultiProjectReplyingSessions = useCallback(async () => {
    try {
      const payload = await apiProtectedJSON<any>(
        appPath("/api/replying-sessions"),
      );
      const items = Array.isArray(payload?.sessions) ? payload.sessions : [];
      const next: Record<string, boolean> = {};
      for (const item of items) {
        const rootID = String(item?.rootId || item?.root_id || "");
        const sessionKey = String(item?.sessionKey || item?.session_key || "");
        if (rootID && sessionKey) {
          next[rootSessionKey(rootID, sessionKey)] = true;
        }
      }
      multiProjectPendingRef.current = next;
      setMultiProjectPendingByKey(next);
      setMultiProjectSessionGroups((groups) =>
        applyPendingToMultiProjectGroups(groups, next),
      );
    } catch (error) {
      console.warn("[multi-project-sessions] replying refresh failed", error);
    }
  }, [applyPendingToMultiProjectGroups, rootSessionKey]);

  useEffect(() => {
    if (!multiProjectSessionsEnabled) {
      return;
    }
    void refreshMultiProjectReplyingSessions();
    void loadMultiProjectSessionGroups();
  }, [
    loadMultiProjectSessionGroups,
    multiProjectSessionsEnabled,
    refreshMultiProjectReplyingSessions,
  ]);

  useEffect(() => {
    if (sessionListMode !== "local") {
      return;
    }
    const trimmed = sessionSearchQuery.trim();
    if (!trimmed) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSessionSearchAppliedQuery(trimmed);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [sessionListMode, sessionSearchQuery]);

  useEffect(() => {
    const currentQuery = sessionSearchQuery.trim();
    if (
      sessionListMode !== "local" ||
      !sessionSearchOpen ||
      !currentRootId ||
      !sessionSearchAppliedQuery ||
      sessionSearchAppliedQuery !== currentQuery
    ) {
      if (
        !currentQuery ||
        sessionListMode !== "local" ||
        !sessionSearchOpen ||
        !currentRootId
      ) {
        setSessionSearchLoading(false);
      }
      return;
    }

    let cancelled = false;
    const searchAcrossRoots =
      !isIDEManagedProject && multiProjectSessionsEnabled;
    setSessionSearchLoading(true);
    void sessionService
      .searchSessions(currentRootId, sessionSearchAppliedQuery, 20, {
        multiRoot: searchAcrossRoots,
      })
      .then((hits) => {
        if (cancelled) return;
        const mapped = hits
          .map((hit) => {
            const hitRootId = String(hit.root_id || currentRootId || "");
            const item = toSessionItem(hitRootId, {
              ...hit,
              root_id: hitRootId,
              search_seq: hit.seq,
              search_snippet: hit.snippet,
              search_match_type: hit.match_type,
            });
            return item;
          })
          .filter((item): item is SessionItem => !!item);
        setSessionSearchResults(mapped);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[session.search] failed", {
          rootId: currentRootId,
          query: sessionSearchAppliedQuery,
          err,
        });
        setSessionSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) {
          setSessionSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentRootId,
    multiProjectSessionsEnabled,
    sessionListMode,
    sessionSearchAppliedQuery,
    sessionSearchOpen,
    sessionSearchQuery,
  ]);

  const handleTreeUpload = useCallback(
    async (files: File[]) => {
      const rootID = currentRootIdRef.current;
      if (!rootID || files.length === 0) return;

      const selectedDirPath =
        selectedDirRef.current === rootID ? "." : selectedDirRef.current;
      const targetDir =
        selectedDirPath ||
        (fileRef.current?.path ? dirnameOfPath(fileRef.current.path) : ".");
      setDirectoryUploadProgress(null);
      try {
        const uploadAbort = new AbortController();
        directoryUploadAbortRef.current = uploadAbort;
        const uploaded = await uploadFiles({
          rootId: rootID,
          dir: targetDir,
          files,
          onProgress: setDirectoryUploadProgress,
          signal: uploadAbort.signal,
        });
        uploaded.forEach((item) => {
          if (typeof item?.path === "string" && item.path) {
            invalidateFileCache(rootID, item.path);
          }
        });
        const currentDir =
          (selectedDirRef.current === rootID ? "." : selectedDirRef.current) ||
          ".";
        const syncMain =
          rootID === currentRootIdRef.current && currentDir === targetDir;
        await refreshTreeDir(rootID, targetDir, syncMain);
        setExpanded((prev) =>
          Array.from(
            new Set([
              ...prev,
              rootID,
              targetDir === "." ? rootID : `${rootID}:${targetDir}`,
            ]),
          ),
        );
      } catch (err) {
        if (!isUploadAbortError(err)) {
          reportError(
            "file.write_failed",
            String((err as Error)?.message || t("file.uploadFailed")),
          );
        }
      } finally {
        directoryUploadAbortRef.current = null;
        setDirectoryUploadProgress(null);
      }
    },
    [refreshTreeDir, t],
  );
  const {
    handleSelectSession,
    tryShowBoundSessionForRoot,
    handleDeleteSession,
    handleRenameSession,
    handlePinSession,
    handleSyncSession,
    handleForkAgentMessage,
  } = useSessionNavigation({
    currentRootIdRef,
    openSessionTab,
    setCurrentRootId,
    setSelectedDir,
    setSelectedDirKey,
    setMainViewPreferenceForRoot,
    drawerSessionByRootRef,
    sessionSearchTargetCounterRef,
    replaceURLState,
    selectedSessionByRootRef,
    rootSessionKey,
    isSessionStale,
    pendingBySessionRef,
    sessionCacheRef,
    setSelectedSessionLoading,
    setSelectedSession,
    setInteractionMode,
    setDrawerOpenForRoot,
    isMobile,
    setIsRightOpen,
    resolvePendingForSession,
    boundSessionByRootRef,
    setDrawerSessionForRoot,
    bumpCacheVersion,
    loadedSessionRef,
    restoreActiveSession,
    clearSessionStale,
    mainViewPreferenceByRootRef,
    setGitDiff,
    setFile,
    setMainEntries,
    setPluginQuery,
    fileCursorRef,
    setIsLeftOpen,
    t,
    sessionsRef,
    setSessions,
    removeSessionTabs,
    loadingSessionRef,
    cancelRequestedBySessionRef,
    staleSessionKeysRef,
    setBoundSessionForRoot,
    setMultiProjectSessionGroups,
    setMultiProjectSessionPending,
    selectedSessionRef,
    fileRef,
    pluginQuery,
    setOpenSessionTabsByRoot,
    setSyncingSessionKeys,
    loadSessionsForRoot,
    handleSelectSessionRef,
  });

  const loadExternalSessions = useCallback(
    async (
      rootID: string,
      agent: string,
      options?: { beforeTime?: string; afterTime?: string; replace?: boolean },
    ) => {
      if (!rootID || !agent) {
        setExternalSessions([]);
        setHasMoreExternalSessions(false);
        setExternalSessionsError("");
        return;
      }
      try {
        if (!options?.beforeTime) {
          setLoadingExternalSessions(true);
        }
        const next = (await sessionService.fetchExternalSessions(
          rootID,
          agent,
          {
            beforeTime: options?.beforeTime,
            afterTime: options?.afterTime,
            filterBound: externalFilterBound,
            limit: 50,
          },
        )) as SessionItem[];
        setExternalSessionsError("");
        setHasMoreExternalSessions(next.length >= 50);
        if (options?.replace || (!options?.beforeTime && !options?.afterTime)) {
          setExternalSessions(next);
          return;
        }
        setExternalSessions((prev) => mergeSessionItems(prev, next));
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : String(err || t("session.importLoadFailed"));
        setExternalSessionsError(message || t("session.importLoadFailed"));
        if (options?.replace || (!options?.beforeTime && !options?.afterTime)) {
          setExternalSessions([]);
          setHasMoreExternalSessions(false);
        }
        console.error("[Session] Failed to fetch external sessions:", err);
      } finally {
        setLoadingExternalSessions(false);
      }
    },
    [externalFilterBound, mergeSessionItems],
  );

  const exitImportMode = useCallback(() => {
    setSessionListMode("local");
    setExternalSelectedKey("");
    setExternalSessionsError("");
    setSelectedExternalImportKeys(new Set());
    setImportingExternalSessionKeys(new Set());
    setImportMenuOpen(false);
  }, []);

  const enterImportMode = useCallback(
    async (agentName: string) => {
      const rootID = currentRootIdRef.current || "";
      const trimmedAgent = String(agentName || "").trim();
      if (!rootID || !trimmedAgent) {
        return;
      }
      setExternalImportAgent(trimmedAgent);
      setExternalSelectedKey("");
      setExternalSessionsError("");
      setSelectedExternalImportKeys(new Set());
      setImportingExternalSessionKeys(new Set());
      setSessionListMode("import");
      await loadExternalSessions(rootID, trimmedAgent, { replace: true });
    },
    [loadExternalSessions],
  );

  const handleLoadOlderExternalSessions = useCallback(async () => {
    const rootID = currentRootIdRef.current || "";
    const oldest =
      externalSessionsRef.current[externalSessionsRef.current.length - 1]
        ?.updated_at || "";
    if (
      !rootID ||
      !externalImportAgent ||
      !oldest ||
      loadingOlderExternalSessions
    ) {
      return;
    }
    setLoadingOlderExternalSessions(true);
    try {
      await loadExternalSessions(rootID, externalImportAgent, {
        beforeTime: oldest,
      });
    } finally {
      setLoadingOlderExternalSessions(false);
    }
  }, [externalImportAgent, loadExternalSessions, loadingOlderExternalSessions]);

  const toggleExternalImportSelection = useCallback((session: SessionItem) => {
    const sessionKey = String(
      session.agent_session_id || session.key || "",
    ).trim();
    if (!sessionKey) {
      return;
    }
    setSelectedExternalImportKeys((current) => {
      const next = new Set(current);
      if (next.has(sessionKey)) {
        next.delete(sessionKey);
      } else {
        next.add(sessionKey);
      }
      return next;
    });
  }, []);

  const toggleAllExternalImportSelection = useCallback((checked: boolean) => {
    const visibleKeys = externalSessionsRef.current
      .map((session) =>
        String(session.agent_session_id || session.key || "").trim(),
      )
      .filter(Boolean);
    setSelectedExternalImportKeys((current) => {
      const next = new Set(current);
      visibleKeys.forEach((key) => {
        if (checked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      });
      return next;
    });
  }, []);

  const handleConfirmExternalImport = useCallback(async () => {
    const rootID = currentRootIdRef.current || "";
    const sessionKeys = [...selectedExternalImportKeys].filter(Boolean);
    if (
      !rootID ||
      !externalImportAgent ||
      !sessionKeys.length ||
      confirmingExternalImport
    ) {
      return;
    }
    setConfirmingExternalImport(true);
    setImportingExternalSessionKeys(new Set(sessionKeys));
    try {
      const imported = await sessionService.importExternalSessionsBatch(
        rootID,
        externalImportAgent,
        sessionKeys,
      );
      const results = imported?.items || [];
      const successItems = results.filter(
        (item) => item.success && item.session_key,
      );
      if (!imported || !successItems.length) {
        const firstError = results.find((item) => !item.success)?.error;
        reportError(
          "session.import_failed",
          firstError
            ? t("session.importFailedWithReason", { reason: firstError })
            : t("session.importFailed"),
        );
        return;
      }
      setConfirmingExternalImport(false);
      setImportingExternalSessionKeys(new Set());
      const failedKeys = new Set(
        results
          .filter((item) => !item.success)
          .map((item) => String(item.agent_session_id || "").trim())
          .filter(Boolean),
      );
      if (failedKeys.size > 0) {
        const firstError = results.find((item) => !item.success)?.error;
        const message = firstError
          ? t("session.importPartialFailedWithReason", {
              count: failedKeys.size,
              reason: firstError,
            })
          : t("session.importPartialFailed", { count: failedKeys.size });
        reportError("session.import_failed", message);
      }
      setSelectedExternalImportKeys(failedKeys);
      if (failedKeys.size === 0) {
        exitImportMode();
      }
      const payload = await sessionService.fetchSessions(rootID, {});
      const next = [...payload.items, ...payload.pinnedItems]
        .map((item) => toSessionItem(rootID, item))
        .filter((item): item is SessionItem => !!item);
      setHasMoreSessions(payload.totalCount > payload.items.length);
      setSessions(
        applyPinnedSnapshotToSessions(
          mergeSessionItems([], next),
          rootID,
          payload.pinnedKeys,
        ),
      );
      const firstImported = successItems[0];
      if (firstImported?.session_key) {
        const source = externalSessionsRef.current.find(
          (item) =>
            String(item.agent_session_id || item.key || "").trim() ===
            String(firstImported.agent_session_id || "").trim(),
        );
        await handleSelectSession({
          key: firstImported.session_key,
          root_id: rootID,
          type: "chat",
          agent: externalImportAgent,
          name: source?.name,
        } as SessionItem);
      }
      if (isMobile && failedKeys.size === 0) {
        setIsRightOpen(false);
      }
    } finally {
      setConfirmingExternalImport(false);
      setImportingExternalSessionKeys(new Set());
    }
  }, [
    confirmingExternalImport,
    exitImportMode,
    externalImportAgent,
    handleSelectSession,
    isMobile,
    selectedExternalImportKeys,
  ]);
  const { handleSendMessage } = useMessageSending({
    currentRootIdRef,
    selectedSessionRef,
    boundSessionByRootRef,
    interactionModeRef,
    sessionCacheRef,
    rootSessionKey,
    currentSessionRef,
    updateSessionAgentForKey,
    setBoundSessionForRoot,
    setSelectedPendingByKey,
    setDrawerSessionForRoot,
    pendingPlanMode,
    t,
    slashCommandResults,
    setMultiProjectSessionPending,
    setSessions,
    drawerSessionByRootRef,
    setSlashCommandResults,
    clearSlashCommandResultForSession,
    pendingRequestRef,
    bumpCacheVersion,
    pendingDraftRef,
    openSessionTab,
    selectedSessionByRootRef,
    setSelectedSession,
    setSelectedSessionLoading,
    setMainViewPreferenceForRoot,
    setInteractionMode,
    setDrawerOpenForRoot,
    replaceURLState,
    attachedFileContext,
    fileRef,
    pluginBypassRef,
    pluginQueryRef,
    pluginManagerRef,
    setPendingPlanMode,
    removeSessionTabs,
  });

  const handleRunAgentLifecycleCommand = useCallback(
    async (
      agentName: string,
      action: "install" | "update",
      commands: string[],
    ) => {
      const activeRoot = currentRootIdRef.current;
      if (!activeRoot) {
        throw new Error(t("root.noProjectForCommand"));
      }
      const script = commands
        .map((command) => command.trim())
        .filter(Boolean)
        .join("\n");
      if (!script) {
        throw new Error(t("agentConfig.noCommand"));
      }
      const previousBoundKey = boundSessionByRootRef.current[activeRoot];
      if (previousBoundKey && !previousBoundKey.startsWith("pending-")) {
        suppressedAutoBindSessionByRootRef.current[activeRoot] =
          previousBoundKey;
      }
      selectedSessionRef.current = null;
      currentSessionRef.current = null;
      setSelectedSession(null);
      selectedSessionByRootRef.current[activeRoot] = null;
      setBoundSessionForRoot(activeRoot, null);
      setDrawerSessionForRoot(activeRoot, null);
      setInteractionMode("drawer");
      setDrawerOpenForRoot(activeRoot, true);
      await handleSendMessage(script, "command", "");
      console.info("[agent/lifecycle] command dispatched", {
        agent: agentName,
        action,
        commandCount: commands.length,
      });
    },
    [
      handleSendMessage,
      setBoundSessionForRoot,
      setDrawerOpenForRoot,
      setDrawerSessionForRoot,
      t,
    ],
  );

  const handleRestartAgent = useCallback(async (agentName: string) => {
    await restartAgent(agentName);
    const items = await fetchAgents(true);
    setAvailableAgents(items);
    setAgentsVersion((v) => v + 1);
  }, []);

  const handleCancelCurrentTurn = useCallback(
    async (sessionKey: string) => {
      const activeRoot = currentRootIdRef.current;
      if (!activeRoot || !sessionKey) return;
      const cacheKey = rootSessionKey(activeRoot, sessionKey);
      cancelRequestedBySessionRef.current[cacheKey] = true;
      const sent = await sessionService.cancelMessage(activeRoot, sessionKey);
      if (!sent) {
        delete cancelRequestedBySessionRef.current[cacheKey];
        return;
      }
      clearLocalPendingForSession(activeRoot, sessionKey);
    },
    [clearLocalPendingForSession, rootSessionKey],
  );

  const markSessionPending = useCallback(
    (rootID: string, sessionKey: string) => {
      if (!rootID || !sessionKey) return;
      const now = new Date().toISOString();
      const cacheKey = rootSessionKey(rootID, sessionKey);
      const cached = sessionCacheRef.current[cacheKey];
      if (cached) {
        sessionCacheRef.current[cacheKey] = {
          ...(cached as any),
          pending: true,
          updated_at: now,
        } as Session;
        bumpCacheVersion();
      }
      setSelectedPendingByKey(sessionKey, true);
      const drawer = drawerSessionByRootRef.current[rootID];
      if (
        drawer &&
        (drawer.key || (drawer as any).session_key) === sessionKey
      ) {
        setDrawerSessionForRoot(rootID, {
          ...(drawer as any),
          pending: true,
          updated_at: now,
        } as Session);
      }
      if (currentRootIdRef.current === rootID) {
        setSessions((prev) =>
          prev.map((item) => {
            const itemKey = item.key || item.session_key;
            if (itemKey !== sessionKey) {
              return item;
            }
            return {
              ...(item as any),
              pending: true,
              updated_at: now,
            } as SessionItem;
          }),
        );
      }
      setMultiProjectSessionPending(rootID, sessionKey, true);
    },
    [
      bumpCacheVersion,
      rootSessionKey,
      setDrawerSessionForRoot,
      setMultiProjectSessionPending,
      setSelectedPendingByKey,
    ],
  );

  const handleRemoveQueuedMessage = useCallback(async (queueId: string) => {
    const activeRoot = currentRootIdRef.current;
    const selected = selectedSessionRef.current;
    const selectedRoot =
      (selected?.root_id as string | undefined) || activeRoot || "";
    const selectedKey = selected?.key || selected?.session_key || "";
    const sessionKey =
      interactionModeRef.current !== "drawer" &&
      selectedRoot === activeRoot &&
      selectedKey &&
      !selectedKey.startsWith("pending-")
        ? selectedKey
        : boundSessionByRootRef.current[activeRoot || ""] || "";
    if (!activeRoot || !sessionKey || !queueId) return;
    await sessionService.removeQueuedMessage(activeRoot, sessionKey, queueId);
  }, []);

  const handleUpdateQueuedMessage = useCallback(
    async (queueId: string, content: string) => {
      const activeRoot = currentRootIdRef.current;
      const selected = selectedSessionRef.current;
      const selectedRoot =
        (selected?.root_id as string | undefined) || activeRoot || "";
      const selectedKey = selected?.key || selected?.session_key || "";
      const sessionKey =
        interactionModeRef.current !== "drawer" &&
        selectedRoot === activeRoot &&
        selectedKey &&
        !selectedKey.startsWith("pending-")
          ? selectedKey
          : boundSessionByRootRef.current[activeRoot || ""] || "";
      if (!activeRoot || !sessionKey || !queueId || !content.trim()) return;
      await sessionService.updateQueuedMessage(
        activeRoot,
        sessionKey,
        queueId,
        content,
      );
    },
    [],
  );

  const handleSendQueuedMessageNow = useCallback(
    async (queueId: string) => {
      const activeRoot = currentRootIdRef.current;
      const selected = selectedSessionRef.current;
      const selectedRoot =
        (selected?.root_id as string | undefined) || activeRoot || "";
      const selectedKey = selected?.key || selected?.session_key || "";
      const sessionKey =
        interactionModeRef.current !== "drawer" &&
        selectedRoot === activeRoot &&
        selectedKey &&
        !selectedKey.startsWith("pending-")
          ? selectedKey
          : boundSessionByRootRef.current[activeRoot || ""] || "";
      if (!activeRoot || !sessionKey || !queueId) return;
      const cacheKey = rootSessionKey(activeRoot, sessionKey);
      const previousQueue = queuedMessagesBySessionRef.current[cacheKey] || [];
      const nextQueue = previousQueue.filter((item) => item.id !== queueId);
      queuedMessagesBySessionRef.current[cacheKey] = nextQueue;
      if (!optimisticDequeuedIdsRef.current[cacheKey]) {
        optimisticDequeuedIdsRef.current[cacheKey] = new Set();
      }
      optimisticDequeuedIdsRef.current[cacheKey].add(queueId);
      setQueueVersion((v) => v + 1);
      markSessionPending(activeRoot, sessionKey);
      const sent = await sessionService.sendQueuedMessageNow(
        activeRoot,
        sessionKey,
        queueId,
      );
      if (!sent) {
        optimisticDequeuedIdsRef.current[cacheKey]?.delete(queueId);
        queuedMessagesBySessionRef.current[cacheKey] = previousQueue;
        setQueueVersion((v) => v + 1);
      }
    },
    [markSessionPending, rootSessionKey],
  );

  const handleNewSession = useCallback(() => {
    const rootID = currentRootIdRef.current;
    const previousBoundKey = rootID
      ? boundSessionByRootRef.current[rootID]
      : "";
    if (
      rootID &&
      previousBoundKey &&
      !previousBoundKey.startsWith("pending-")
    ) {
      suppressedAutoBindSessionByRootRef.current[rootID] = previousBoundKey;
    }
    setMainViewPreferenceForRoot(rootID, "session");
    selectedSessionRef.current = null;
    currentSessionRef.current = null;
    interactionModeRef.current = "main";
    setSelectedSession(null);
    if (rootID) {
      selectedSessionByRootRef.current[rootID] = null;
    }
    setBoundSessionForRoot(rootID, null);
    setDrawerSessionForRoot(rootID, null);
    setInteractionMode("main");
    setDrawerOpenForRoot(rootID, false);
    replaceURLState({
      ...readURLState(),
      root: rootID || "",
      session: "",
      cursor: 0,
    });
  }, [
    replaceURLState,
    setBoundSessionForRoot,
    setDrawerOpenForRoot,
    setDrawerSessionForRoot,
    setMainViewPreferenceForRoot,
  ]);

  const handleSelectSessionTab = useCallback(
    (rootID: string, sessionKey: string) => {
      const tab = (openSessionTabsByRoot[rootID] || []).find(
        (item) => (item.key || item.session_key) === sessionKey,
      );
      if (!tab) return;
      const latest = sessionsRef.current.find(
        (item) =>
          (item.key || item.session_key) === sessionKey &&
          ((item.root_id as string | undefined) || rootID) === rootID,
      );
      void handleSelectSession({ ...tab, ...latest, root_id: rootID });
    },
    [handleSelectSession, openSessionTabsByRoot],
  );

  const handleCloseSessionTab = useCallback(
    (rootID: string, sessionKey: string) => {
      const tabs = openSessionTabsByRoot[rootID] || [];
      const closedIndex = tabs.findIndex(
        (item) => (item.key || item.session_key) === sessionKey,
      );
      if (closedIndex < 0) return;
      removeSessionTabs(rootID, new Set([sessionKey]));

      const selected = selectedSessionRef.current;
      const selectedKey = selected?.key || selected?.session_key || "";
      const selectedRoot =
        (selected?.root_id as string | undefined) || currentRootIdRef.current;
      if (selectedKey !== sessionKey || selectedRoot !== rootID) return;

      const nextTab = tabs[closedIndex + 1] || tabs[closedIndex - 1];
      if (nextTab) {
        const nextKey = nextTab.key || nextTab.session_key;
        handleSelectSessionTab(rootID, nextKey);
      } else {
        handleNewSession();
      }
    },
    [
      handleNewSession,
      handleSelectSessionTab,
      openSessionTabsByRoot,
      removeSessionTabs,
    ],
  );

  const currentSelectionSource = useMemo(() => {
    if (file?.path) {
      return {
        path: file.path,
        name: file.name || basenameOfPath(file.path),
      };
    }
    if (gitDiff?.path) {
      return {
        path: gitDiff.path,
        name: basenameOfPath(gitDiff.path),
      };
    }
    return null;
  }, [file, gitDiff]);

  const buildAttachedFileContext = useCallback(
    (
      currentSource: { path: string; name: string } | null,
      selection: ViewerSelection | null,
    ): AttachedFileContext | null => {
      if (!currentSource?.path) {
        return null;
      }
      const matchesCurrentFile = selection?.filePath === currentSource.path;
      return {
        filePath: currentSource.path,
        fileName: currentSource.name,
        startLine: matchesCurrentFile ? selection?.startLine : undefined,
        endLine: matchesCurrentFile ? selection?.endLine : undefined,
        text: matchesCurrentFile ? selection?.text : undefined,
      };
    },
    [],
  );

  const handleRequestFileContext = useCallback(() => {
    const currentSource = currentSelectionSource;
    if (
      dismissedSelectionFileRef.current &&
      dismissedSelectionFileRef.current === currentSource?.path
    ) {
      return;
    }
    const liveSelection = viewerSelectionRef.current;
    const fallbackSelection = lastViewerSelectionRef.current;
    const nextSelection =
      liveSelection?.filePath === currentSource?.path
        ? liveSelection
        : fallbackSelection?.filePath === currentSource?.path
          ? fallbackSelection
          : null;
    const next = buildAttachedFileContext(currentSource, nextSelection);
    setAttachedFileContext(next);
  }, [buildAttachedFileContext, currentSelectionSource]);

  const handleClearFileContext = useCallback(() => {
    dismissedSelectionFileRef.current = currentSelectionSource?.path || null;
    lastViewerSelectionRef.current = null;
    setAttachedFileContext(null);
  }, [currentSelectionSource]);

  const handleViewerSelectionChange = useCallback(
    (next: ViewerSelection | null) => {
      setViewerSelection(next);
      if (next?.filePath) {
        dismissedSelectionFileRef.current = null;
        lastViewerSelectionRef.current = next;
      }
    },
    [],
  );

  useEffect(() => {
    const currentPath = currentSelectionSource?.path;
    if (!currentPath) {
      dismissedSelectionFileRef.current = null;
      lastViewerSelectionRef.current = null;
      setViewerSelection(null);
      setAttachedFileContext(null);
      return;
    }
    if (
      dismissedSelectionFileRef.current &&
      dismissedSelectionFileRef.current !== currentPath
    ) {
      dismissedSelectionFileRef.current = null;
    }
    if (lastViewerSelectionRef.current?.filePath !== currentPath) {
      lastViewerSelectionRef.current = null;
    }
    setViewerSelection((prev) =>
      prev?.filePath === currentPath ? prev : null,
    );
    setAttachedFileContext((prev) => {
      if (!prev) {
        return prev;
      }
      if (prev.filePath !== currentPath) {
        return null;
      }
      return prev;
    });
  }, [currentSelectionSource?.path]);

  useEffect(() => {
    const currentPath = currentSelectionSource?.path;
    setAttachedFileContext((prev) => {
      if (!prev || prev.filePath !== currentPath) {
        return prev;
      }
      if (!viewerSelection || viewerSelection.filePath !== currentPath) {
        return prev;
      }
      return buildAttachedFileContext(currentSelectionSource, viewerSelection);
    });
  }, [buildAttachedFileContext, currentSelectionSource, viewerSelection]);

  const rememberCurrentFileScroll = useCallback(() => {
    const currentFile = fileRef.current;
    const key = buildFileScrollKey(
      currentFile?.root || currentRootIdRef.current,
      currentFile?.path,
    );
    if (!key) return;
    if (!(key in fileScrollPositionsRef.current)) {
      fileScrollPositionsRef.current[key] = 0;
      persistFileScrollPositions(fileScrollPositionsRef.current);
    }
  }, []);

  const actionHandlers = useMemo(
    () => ({
      open: async (params: any) => {
        const requestId = ++fileOpenRequestRef.current;
        if (!params?.preserveRelatedSelection) {
          setRelatedSelectedFileKey("");
        }
        const isStale = () => fileOpenRequestRef.current !== requestId;
        const parsedLocation = parseFileLocation(String(params.path || ""));
        const root = params.root || currentRootIdRef.current;
        const rootInfo = root
          ? managedRootByIdRef.current[String(root)]
          : undefined;
        const path = normalizePathForRoot(
          parsedLocation.path,
          rootInfo?.root_path,
        );
        if (!path || !root) return;
        setMainViewPreferenceForRoot(String(root), "file");
        rememberCurrentFileScroll();
        setGitDiff(null);
        const currentFilePath = fileRef.current?.path || "";
        const currentFileRoot =
          fileRef.current?.root || currentRootIdRef.current || "";
        const isFileSwitch =
          currentFilePath !== String(path) || currentFileRoot !== String(root);
        if (isFileSwitch) {
          pluginBypassRef.current = false;
          setPluginBypass(false);
          // Only tear down the current file view when switching to a different file/root.
          // Reopening the same file (for example from session view back to file view) should
          // preserve the existing scroll position and DOM state until fresh content arrives.
          setFile(null);
        }
        if (currentRootIdRef.current !== root) {
          setCurrentRootId(root);
        }
        setSelectedDir(String(root));
        setSelectedDirKey(null);
        const requestedCursor = normalizeCursor(params.cursor);
        const cursor = requestedCursor === null ? 0 : requestedCursor;
        const preserveQuery = !!params.preservePluginQuery;
        const persistedQuery = loadPersistedPluginQuery(
          String(root),
          String(path),
        );
        const urlQuery = preserveQuery
          ? parsePluginQuery(window.location.search)
          : {};
        // Priority: URL query > localStorage persisted query.
        const nextPluginQuery = preserveQuery
          ? { ...persistedQuery, ...urlQuery }
          : persistedQuery;
        setPluginQuery(nextPluginQuery);
        replaceURLState({
          root,
          file: path,
          session: "",
          cursor,
          pluginQuery: nextPluginQuery,
        });
        persistPluginQuery(String(root), String(path), nextPluginQuery);

        const expandAndLoadTreeForFile = async () => {
          const dirs = parentDirsOfFile(String(path));
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(String(root));
            dirs.forEach((dir) => next.add(`${root}:${dir}`));
            return Array.from(next);
          });
          const toLoad = [".", ...dirs];
          for (const dir of toLoad) {
            const cacheKey = treeCacheKey(String(root), dir);
            if (
              Object.prototype.hasOwnProperty.call(
                entriesByPathRef.current,
                cacheKey,
              ) &&
              !invalidTreeCacheKeysRef.current.has(cacheKey)
            ) {
              continue;
            }
            try {
              const payload = await apiProtectedJSON<any>(
                appURL(
                  "/api/tree",
                  new URLSearchParams({ root: String(root), dir }),
                ),
              );
              const parsed = normalizeTreeResponse(payload);
              invalidTreeCacheKeysRef.current.delete(cacheKey);
              setEntriesByPath((prev) => ({
                ...prev,
                [cacheKey]: parsed.entries,
              }));
            } catch {}
          }
        };

        void expandAndLoadTreeForFile();
        try {
          const fetchFileWithMode = async (
            mode: "full" | "incremental",
            timeoutMs?: number,
          ) =>
            fetchFile({
              rootId: String(root),
              path: String(path),
              readMode: mode,
              cursor,
              timeoutMs,
            });

          let readMode: "incremental" | "full" =
            params.readMode === "full" ? "full" : "incremental";
          let requiresFull = params.readMode === "full";
          if (params.readMode !== "full" && params.readMode !== "incremental") {
            const currentFilePath = fileRef.current?.path || "";
            const currentFileRoot =
              fileRef.current?.root || currentRootIdRef.current || "";
            const targetPath = String(path);
            const targetRoot = String(root);
            const sameFileReload =
              pluginBypassRef.current &&
              currentFilePath === targetPath &&
              currentFileRoot === targetRoot;

            if (sameFileReload) {
              readMode = "incremental";
            } else {
              try {
                const plugin = pluginManagerRef.current.match(
                  root,
                  buildMatchInputFromPath(path, nextPluginQuery),
                );
                readMode = inferReadModeFromPlugin(plugin);
                requiresFull = readMode === "full";
              } catch {
                readMode = "incremental";
              }
            }
          }
          const cached = await getCachedFile({
            rootId: String(root),
            path: String(path),
            readMode,
            cursor,
          });
          if (cached && !isStale()) {
            setFile({
              ...cached,
              targetLine: parsedLocation.targetLine,
              targetColumn: parsedLocation.targetColumn,
            });
          }

          let next: FilePayload | null;
          try {
            next = await fetchFileWithMode(
              readMode,
              requiresFull ? undefined : readMode === "full" ? 1500 : undefined,
            );
          } catch (err) {
            if (readMode === "full" && !requiresFull) {
              next = await fetchFileWithMode("incremental");
              readMode = "incremental";
            } else {
              throw err;
            }
          }
          if (isStale()) {
            return;
          }
          if (next) {
            setFile({
              ...next,
              targetLine: parsedLocation.targetLine,
              targetColumn: parsedLocation.targetColumn,
            });
          }
          fileCursorRef.current = cursor;
          setSelectedSession(null);
          setSelectedSessionLoading(false);
          setDrawerOpenForRoot(root, false);
          if (isMobile) setIsLeftOpen(false);
        } catch (err) {
          const status = extractHTTPStatusFromErrorMessage(
            (err as Error)?.message || "",
          );
          if (status && (await handleRelayNavigationFailure(status, ""))) {
            return;
          }
          console.error("[file.open] failed", { root, path, cursor, err });
        }
      },
      open_dir: async (params: any) => {
        fileOpenRequestRef.current += 1;
        const path = params.path,
          rootParam = params.root || currentRootIdRef.current,
          isToggle = !!params.toggle,
          forceDirectory = !!params.forceDirectory,
          suppressTreeExpand = !!params.suppressTreeExpand;
        if (!path || !rootParam) return;
        setGitDiff(null);
        const isActuallyRoot = params.isRoot === true;
        const root = isActuallyRoot ? path : rootParam;
        const expandedKey = isActuallyRoot ? path : `${root}:${path}`;
        const preserveCollapsedRoot =
          isActuallyRoot &&
          suppressTreeExpand &&
          !expandedRef.current.includes(expandedKey);
        const restoreSuppressedRootExpansion = () => {
          if (!preserveCollapsedRoot) {
            return;
          }
          setExpanded((prev) => prev.filter((k) => k !== expandedKey));
        };
        const preserveQuery = !!params.preservePluginQuery;
        const nextPluginQuery = preserveQuery
          ? parsePluginQuery(window.location.search)
          : {};
        const loadDirectoryView = async (
          targetPath: string,
          targetIsRoot: boolean,
        ) => {
          const apiDir = targetIsRoot ? "." : targetPath;
          const cacheKey = treeCacheKey(root, apiDir);
          if (currentRootIdRef.current !== root) {
            setCurrentRootId(root);
          }
          setMainViewPreferenceForRoot(root, "directory");
          setFile(null);
          setSelectedSession(null);
          setSelectedSessionLoading(false);
          setMainEntries([]);
          setMainDirectoryError("");
          setPluginQuery(nextPluginQuery);
          replaceURLState({
            root,
            file: "",
            session: "",
            cursor: 0,
            pluginQuery: nextPluginQuery,
          });
          const cachedEntries = entriesByPathRef.current[cacheKey];
          if (
            Object.prototype.hasOwnProperty.call(
              entriesByPathRef.current,
              cacheKey,
            ) &&
            !invalidTreeCacheKeysRef.current.has(cacheKey)
          ) {
            setMainEntries(cachedEntries || []);
            setMainDirectoryError("");
            setSelectedDir(targetPath);
            setSelectedDirKey(
              buildDirectorySelectionKey(root, targetPath, targetIsRoot),
            );
            setFile(null);
            setSelectedSession(null);
            setSelectedSessionLoading(false);
            fileCursorRef.current = 0;
            setDrawerOpenForRoot(root, false);
            if (!isToggle && isMobile) setIsLeftOpen(false);
            return;
          }
          try {
            const payload = await apiProtectedJSON<any>(
              appURL("/api/tree", new URLSearchParams({ root, dir: apiDir })),
            );
            const parsed = normalizeTreeResponse(payload);
            invalidTreeCacheKeysRef.current.delete(cacheKey);
            setMainDirectoryError("");
            setEntriesByPath((prev) => ({
              ...prev,
              [cacheKey]: parsed.entries,
            }));
            setMainEntries(parsed.entries);
            setSelectedDir(targetPath);
            setSelectedDirKey(
              buildDirectorySelectionKey(root, targetPath, targetIsRoot),
            );
            setFile(null);
            setSelectedSession(null);
            setSelectedSessionLoading(false);
            fileCursorRef.current = 0;
            setDrawerOpenForRoot(root, false);
            if (!isToggle && isMobile) setIsLeftOpen(false);
          } catch (error) {
            if (error instanceof ProtectedAPIError) {
              if (
                await handleRelayNavigationFailure(
                  error.status,
                  typeof error.payload?.error === "string"
                    ? error.payload.error
                    : "",
                )
              ) {
                return;
              }
              const message = formatDirectoryLoadError(
                typeof error.payload?.error === "string"
                  ? error.payload.error
                  : "",
              );
              setSelectedDir(targetPath);
              setSelectedDirKey(
                buildDirectorySelectionKey(root, targetPath, targetIsRoot),
              );
              setMainEntries([]);
              setMainDirectoryError(message);
              reportError("file.read_failed", message);
              return;
            }
            const message = t("directory.loadFailedRetry");
            setSelectedDir(targetPath);
            setSelectedDirKey(
              buildDirectorySelectionKey(root, targetPath, targetIsRoot),
            );
            setMainEntries([]);
            setMainDirectoryError(message);
            reportError("file.read_failed", message);
          }
        };
        const isExpanded = expandedRef.current.includes(expandedKey);
        const isCurrentExpandedRoot =
          isActuallyRoot && isExpanded && currentRootIdRef.current === root;
        if (
          isToggle &&
          ((!isActuallyRoot && isExpanded) || isCurrentExpandedRoot)
        ) {
          setExpanded((prev) => prev.filter((k) => k !== expandedKey));
          if (!isActuallyRoot) {
            const parentDir = dirnameOfPath(path);
            const parentPath = parentDir === "." ? root : parentDir;
            await loadDirectoryView(parentPath, parentDir === ".");
          }
          return;
        }
        if (isActuallyRoot) {
          setCurrentRootId(path);
          if (!suppressTreeExpand) {
            setExpanded((prev) => Array.from(new Set([...prev, path])));
          }
          if (!forceDirectory) {
            const restored = await tryShowBoundSessionForRoot(path, {
              pluginQuery: nextPluginQuery,
              closeLeftSidebar: !isToggle,
            });
            if (restored) {
              void loadSessionsForRoot(path, { replace: true, force: true });
              await refreshTreeDir(path, ".", false);
              restoreSuppressedRootExpansion();
              return;
            }
          }
        } else {
          setExpanded((prev) => Array.from(new Set([...prev, expandedKey])));
        }
        await loadDirectoryView(path, isActuallyRoot);
        restoreSuppressedRootExpansion();
      },
    }),
    [
      handleRelayNavigationFailure,
      isMobile,
      normalizeTreeResponse,
      setMainViewPreferenceForRoot,
      setDrawerOpenForRoot,
      replaceURLState,
      rememberCurrentFileScroll,
      treeCacheKey,
      tryShowBoundSessionForRoot,
      loadSessionsForRoot,
    ],
  );
  const actionHandlersRef = useRef(actionHandlers);
  const openProject = useCallback(
    (
      rootId: string,
      options?: { forceDirectory?: boolean; preservePluginQuery?: boolean },
    ) =>
      actionHandlersRef.current.open_dir({
        path: rootId,
        root: rootId,
        isRoot: true,
        ...options,
      }),
    [],
  );
  useEffect(() => {
    actionHandlersRef.current = actionHandlers;
  }, [actionHandlers]);

  const openRelatedFileDiff = useCallback(
    async (rootID: string, file: RelatedFileClickTarget) => {
      const path = String(file?.path || "").trim();
      const head = String(file?.head || "").trim();
      const repoKind = String(file?.repo_kind || "").trim();
      if (!rootID || !path) {
        return;
      }
      setRelatedSelectedFileKey(relatedFileSelectionKey(file));
      if (repoKind === "plain") {
        actionHandlers.open({
          path,
          root: rootID,
          preserveRelatedSelection: true,
        });
        return;
      }
      if (!head && !file?.repo_path) {
        const gitItem = (gitStatus?.items || []).find(
          (item) => item.path === path,
        );
        if (gitItem) {
          void openGitDiff(rootID, gitItem, { preserveRelatedSelection: true });
          return;
        }
        actionHandlers.open({
          path,
          root: rootID,
          preserveRelatedSelection: true,
        });
        return;
      }
      fileOpenRequestRef.current += 1;
      setMainViewPreferenceForRoot(rootID, "git-diff");
      setSelectedSession(null);
      setSelectedSessionLoading(false);
      setFile(null);
      setGitDiff(null);
      replaceURLState({
        root: rootID,
        file: "",
        session: "",
        cursor: 0,
        pluginQuery: {},
      });
      try {
        const next = await fetchGitRelatedFileDiff(rootID, file);
        const rootPath = managedRootByIdRef.current[rootID]?.root_path;
        const repoPath = String(file?.repo_path || "").trim();
        const displayPath = repoPath
          ? relativeDisplayPathFromRoot(
              rootPath,
              joinDisplayPath(repoPath, path),
            )
          : path;
        if (displayPath) {
          next.display_path = displayPath;
        }
        setGitDiff(next);
        if (currentRootIdRef.current !== rootID) {
          setCurrentRootId(rootID);
        }
        if (isMobile) {
          setIsLeftOpen(false);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("git.relatedFileDiffFailed");
        console.error("[git.related-file.diff] failed", {
          rootID,
          path,
          head,
          err,
        });
        reportError("git.related_file_diff_failed", message, {
          severity: "warning",
          recoverable: true,
          details: {
            root: rootID,
            path,
            head,
            payload: err instanceof ProtectedAPIError ? err.payload : undefined,
          },
        });
      }
    },
    [
      actionHandlers,
      gitStatus,
      isMobile,
      openGitDiff,
      replaceURLState,
      setMainViewPreferenceForRoot,
    ],
  );

  const loadManagedRootPayloads = useCallback(async () => {
    if (bootstrapService.snapshot().phase !== "ready") {
      return null;
    }
    if (managedRootsRequestRef.current) {
      return managedRootsRequestRef.current;
    }
    const request = (async () => {
      try {
        const dirs = await apiProtectedJSON<ManagedRootPayload[]>(
          appPath("/api/dirs"),
        );
        return Array.isArray(dirs) ? dirs : [];
      } catch (error) {
        if (!(error instanceof ProtectedAPIError)) {
          return null;
        }
        if (
          await handleRelayNavigationFailure(
            error.status,
            typeof error.payload?.error === "string" ? error.payload.error : "",
          )
        ) {
          return null;
        }
        return null;
      }
    })().finally(() => {
      managedRootsRequestRef.current = null;
    });
    managedRootsRequestRef.current = request;
    return request;
  }, [bootstrapState.phase, handleRelayNavigationFailure]);

  const refreshManagedRoots = useCallback(async () => {
    const dirs = await loadManagedRootPayloads();
    if (!dirs) {
      return;
    }
    const nextDirs = Array.isArray(dirs) ? dirs : [];
    syncRelayNodesToNative(nextDirs);
    const nextRootIds = nextDirs.map((dir) => dir.id).filter(Boolean);
    const previousRootById = managedRootByIdRef.current;
    const nextRootById = Object.fromEntries(
      nextDirs.filter((dir) => !!dir.id).map((dir) => [dir.id, dir]),
    );
    let clearedRootScopedState = false;
    for (const rootID of Object.keys(previousRootById)) {
      if (!(rootID in nextRootById)) {
        clearRootScopedClientState(rootID, { removeLastRoot: true });
        clearedRootScopedState = true;
      }
    }
    for (const rootID of nextRootIds) {
      const previousPath = comparableManagedRootPath(
        previousRootById[rootID]?.root_path,
      );
      const nextPath = comparableManagedRootPath(
        nextRootById[rootID]?.root_path,
      );
      if (previousPath && nextPath && previousPath !== nextPath) {
        clearRootScopedClientState(rootID);
        clearedRootScopedState = true;
      }
    }
    managedRootByIdRef.current = nextRootById;
    if (clearedRootScopedState && multiProjectSessionsEnabled) {
      void refreshMultiProjectReplyingSessions();
      void loadMultiProjectSessionGroups();
    }

    managedRootIdsRef.current = new Set(nextRootIds);
    setManagedRootIds(nextRootIds);
    setRootEntries(mapManagedRootsToEntries(nextDirs));
    Object.keys(selectedSessionByRootRef.current).forEach((rootID) => {
      if (!nextRootIds.includes(rootID)) {
        delete selectedSessionByRootRef.current[rootID];
      }
    });
    setOpenSessionTabsByRoot((prev) => {
      let changed = false;
      const next: Record<string, OpenSessionTab[]> = {};
      for (const [rootID, tabs] of Object.entries(prev)) {
        if (nextRootIds.includes(rootID)) next[rootID] = tabs;
        else changed = true;
      }
      return changed ? next : prev;
    });

    if (nextRootIds.length === 0) {
      setCurrentRootId(null);
      setSelectedDir(null);
      setSelectedDirKey(null);
      setMainEntries([]);
      setFile(null);
      setSelectedSession(null);
      setSelectedSessionLoading(false);
      setSessions([]);
      setCurrentSession(null);
      setActiveBoundSessionKey(null);
      selectedSessionByRootRef.current = {};
      setOpenSessionTabsByRoot({});
      setInteractionMode("main");
      setIsDrawerOpen(false);
      replaceURLState({
        root: "",
        file: "",
        session: "",
        cursor: 0,
        pluginQuery: {},
      });
      return;
    }

    const currentRoot = currentRootIdRef.current;
    if (currentRoot && nextRootIds.includes(currentRoot)) {
      return;
    }

    const lastRoot = loadLastRootId();
    const nextRoot =
      lastRoot && nextRootIds.includes(lastRoot) ? lastRoot : nextRootIds[0];
    await actionHandlersRef.current.open_dir({
      path: nextRoot,
      root: nextRoot,
      preservePluginQuery: true,
      isRoot: true,
    });
  }, [
    clearRootScopedClientState,
    loadManagedRootPayloads,
    loadMultiProjectSessionGroups,
    multiProjectSessionsEnabled,
    refreshMultiProjectReplyingSessions,
    replaceURLState,
  ]);

  const applyManagedRootRename = useCallback(
    (oldRootID: string, rootPayload: ManagedRootPayload | null | undefined) => {
      const oldID = String(oldRootID || "").trim();
      const nextID = String(rootPayload?.id || "").trim();
      if (!oldID || !nextID) {
        return false;
      }

      const previousRoot =
        managedRootByIdRef.current[oldID] ||
        managedRootByIdRef.current[nextID] ||
        ({} as ManagedRootPayload);
      const nextRoot = {
        ...previousRoot,
        ...rootPayload,
        id: nextID,
      } as ManagedRootPayload;

      const nextRootById = { ...managedRootByIdRef.current };
      delete nextRootById[oldID];
      nextRootById[nextID] = nextRoot;
      managedRootByIdRef.current = nextRootById;

      const moveRecordKey = <T,>(record: Record<string, T>) => {
        if (oldID === nextID || !(oldID in record)) {
          return;
        }
        record[nextID] = record[oldID];
        delete record[oldID];
      };
      moveRecordKey(boundSessionByRootRef.current);
      moveRecordKey(suppressedAutoBindSessionByRootRef.current);
      moveRecordKey(drawerSessionByRootRef.current);
      moveRecordKey(selectedSessionByRootRef.current);
      moveRecordKey(mainViewPreferenceByRootRef.current);
      moveRecordKey(drawerOpenByRootRef.current);
      moveRecordKey(pluginsLoadedByRootRef.current);
      moveRecordKey(pluginsLoadingByRootRef.current);

      const moveStateRecord = <T,>(record: Record<string, T>) => {
        if (oldID === nextID || !(oldID in record)) {
          return record;
        }
        const next = { ...record, [nextID]: record[oldID] };
        delete next[oldID];
        return next;
      };
      setGitStatusExpandedByRoot((prev) => moveStateRecord(prev));
      setGitHistoryExpandedByRoot((prev) => moveStateRecord(prev));

      setOpenSessionTabsByRoot((prev) => moveStateRecord(prev));

      const moveCacheRecord = <T,>(record: Record<string, T>) => {
        if (oldID === nextID) {
          return;
        }
        const oldPrefix = `${oldID}::`;
        for (const key of Object.keys(record)) {
          if (!key.startsWith(oldPrefix)) {
            continue;
          }
          const nextKey = `${nextID}::${key.slice(oldPrefix.length)}`;
          record[nextKey] = record[key];
          delete record[key];
        }
      };
      moveCacheRecord(sessionCacheRef.current);
      moveCacheRecord(loadedSessionRef.current);
      if (oldID !== nextID) {
        staleSessionKeysRef.current = new Set(
          Array.from(staleSessionKeysRef.current).map((key) =>
            key.startsWith(`${oldID}::`)
              ? `${nextID}::${key.slice(`${oldID}::`.length)}`
              : key,
          ),
        );
      }

      const moveTreeRecord = <T,>(record: Record<string, T>) => {
        if (oldID === nextID) {
          return record;
        }
        const next = { ...record };
        const oldPrefix = `${oldID}:`;
        for (const key of Object.keys(record)) {
          if (!key.startsWith(oldPrefix)) {
            continue;
          }
          const nextKey = `${nextID}:${key.slice(oldPrefix.length)}`;
          next[nextKey] = record[key];
          delete next[key];
        }
        return next;
      };
      entriesByPathRef.current = moveTreeRecord(entriesByPathRef.current);
      setEntriesByPath((prev) => moveTreeRecord(prev));
      if (oldID !== nextID) {
        invalidTreeCacheKeysRef.current = new Set(
          Array.from(invalidTreeCacheKeysRef.current).map((key) =>
            key.startsWith(`${oldID}:`)
              ? `${nextID}:${key.slice(`${oldID}:`.length)}`
              : key,
          ),
        );
      }

      setManagedRootIds((prev) => {
        const source = prev.length
          ? prev
          : Array.from(managedRootIdsRef.current);
        let replaced = false;
        const nextIds = source.map((id) => {
          if (id !== oldID) {
            return id;
          }
          replaced = true;
          return nextID;
        });
        if (!replaced && !nextIds.includes(nextID)) {
          nextIds.push(nextID);
        }
        const deduped = Array.from(new Set(nextIds.filter(Boolean)));
        managedRootIdsRef.current = new Set(deduped);
        setRootEntries(
          mapManagedRootsToEntries(
            deduped
              .map((id) => managedRootByIdRef.current[id])
              .filter((dir): dir is ManagedRootPayload => !!dir),
          ),
        );
        return deduped;
      });
      return true;
    },
    [],
  );

  const startRelayBinding = useCallback(async () => {
    return bootstrapService.startRelayBinding();
  }, []);

  const normalizeComparableRootPath = useCallback((value: string): string => {
    let normalized = String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    if (/^[a-z]:/i.test(normalized)) {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  }, []);

  const findManagedRootByPath = useCallback(
    (path: string): ManagedRootPayload | null => {
      const target = normalizeComparableRootPath(path);
      if (!target) {
        return null;
      }
      for (const root of Object.values(managedRootByIdRef.current)) {
        if (normalizeComparableRootPath(root.root_path || "") === target) {
          return root;
        }
      }
      return null;
    },
    [normalizeComparableRootPath],
  );

  const loadProjectTreeWorktrees = useCallback(
    async (rootID: string): Promise<GitWorktreeItem[]> => {
      if (!rootID) {
        return [];
      }
      setWorktreeLoadingByRoot((prev) => ({ ...prev, [rootID]: true }));
      setWorktreeErrorByRoot((prev) => ({ ...prev, [rootID]: "" }));
      try {
        const payload = await fetchGitWorktrees(rootID);
        (payload.items || []).forEach((item) => {
          if (item.path) {
            knownWorktreePathsRef.current.add(item.path);
          }
        });
        const items = (payload.items || []).filter((item) => !!item.branch);
        setWorktreeItemsByRoot((prev) => ({
          ...prev,
          [rootID]: items,
        }));
        return items;
      } catch (error) {
        setWorktreeItemsByRoot((prev) => ({ ...prev, [rootID]: [] }));
        setWorktreeErrorByRoot((prev) => ({
          ...prev,
          [rootID]:
            error instanceof Error ? error.message : t("worktree.loadFailed"),
        }));
        return [];
      } finally {
        setWorktreeLoadingByRoot((prev) => ({ ...prev, [rootID]: false }));
      }
    },
    [t],
  );

  const loadProjectTreeWorktreeStatus = useCallback(
    async (worktreePath: string) => {
      if (!worktreePath) {
        return;
      }
      setWorktreeStatusLoadingByPath((prev) => ({
        ...prev,
        [worktreePath]: true,
      }));
      try {
        const status = await fetchGitStatusByPath(worktreePath);
        setWorktreeStatusByPath((prev) => ({
          ...prev,
          [worktreePath]: status,
        }));
      } catch (error) {
        console.error("[git.worktree.status] failed", { worktreePath, error });
        setWorktreeStatusByPath((prev) => ({
          ...prev,
          [worktreePath]: {
            available: false,
            dirty_count: 0,
            items: [],
          } as GitStatusPayload,
        }));
      } finally {
        setWorktreeStatusLoadingByPath((prev) => ({
          ...prev,
          [worktreePath]: false,
        }));
      }
    },
    [],
  );

  useEffect(() => {
    if (projectTreeTab !== "worktrees" || !currentRootId) {
      return;
    }
    if (
      worktreeItemsByRoot[currentRootId] ||
      worktreeLoadingByRoot[currentRootId]
    ) {
      return;
    }
    void loadProjectTreeWorktrees(currentRootId);
  }, [
    currentRootId,
    loadProjectTreeWorktrees,
    projectTreeTab,
    worktreeItemsByRoot,
    worktreeLoadingByRoot,
  ]);

  const ensurePluginsLoaded = useCallback(async (rootId: string) => {
    if (!rootId || pluginsLoadedByRootRef.current[rootId]) {
      return;
    }
    if (pluginsTrustPendingByRootRef.current[rootId]) {
      return;
    }
    const inflight = pluginsLoadingByRootRef.current[rootId];
    if (inflight) {
      await inflight;
      return;
    }
    setPluginLoading(true);
    const request = scanPluginSources(
      rootId,
      managedRootByIdRef.current[rootId]?.root_path || rootId,
    )
      .then(async (bundle) => {
        const snapshot = snapshotFromPluginSources(bundle);
        if (
          bundle.plugins.length > 0 &&
          !isPluginSnapshotTrusted(snapshot, readTrustedPluginSet(rootId))
        ) {
          pluginManagerRef.current.clear(rootId);
          pluginsTrustPendingByRootRef.current[rootId] = true;
          setPendingPluginTrust({ rootId, bundle });
          setPluginVersion((v) => v + 1);
          return;
        }
        const plugins = await loadPluginsFromSources(bundle.plugins);
        pluginManagerRef.current.set(rootId, plugins);
        pluginsLoadedByRootRef.current[rootId] = true;
        setPluginVersion((v) => v + 1);
      })
      .catch(() => {
        pluginManagerRef.current.clear(rootId);
        pluginsLoadedByRootRef.current[rootId] = true;
        setPluginVersion((v) => v + 1);
      })
      .finally(() => {
        delete pluginsLoadingByRootRef.current[rootId];
        setPluginLoading(false);
      });
    pluginsLoadingByRootRef.current[rootId] = request;
    await request;
  }, []);

  const handleTrustPendingPlugins = useCallback(async () => {
    const pending = pendingPluginTrust;
    if (!pending) return;
    setPluginLoading(true);
    try {
      const snapshot = snapshotFromPluginSources(pending.bundle);
      saveTrustedPluginSet(pending.rootId, snapshot);
      const plugins = await loadPluginsFromSources(pending.bundle.plugins);
      pluginManagerRef.current.set(pending.rootId, plugins);
      pluginsLoadedByRootRef.current[pending.rootId] = true;
      delete pluginsTrustPendingByRootRef.current[pending.rootId];
      setPendingPluginTrust((current) =>
        current?.rootId === pending.rootId ? null : current,
      );
      setPluginVersion((v) => v + 1);
    } finally {
      setPluginLoading(false);
    }
  }, [pendingPluginTrust]);

  const handleDisablePendingPlugins = useCallback(() => {
    const pending = pendingPluginTrust;
    if (!pending) return;
    pluginManagerRef.current.clear(pending.rootId);
    pluginsLoadedByRootRef.current[pending.rootId] = true;
    delete pluginsTrustPendingByRootRef.current[pending.rootId];
    setPendingPluginTrust((current) =>
      current?.rootId === pending.rootId ? null : current,
    );
    setPluginVersion((v) => v + 1);
  }, [pendingPluginTrust]);

  const invalidatePluginsForRoot = useCallback(
    (rootId: string) => {
      if (!rootId) return;
      pluginManagerRef.current.clear(rootId);
      delete pluginsLoadedByRootRef.current[rootId];
      delete pluginsLoadingByRootRef.current[rootId];
      delete pluginsTrustPendingByRootRef.current[rootId];
      setPendingPluginTrust((current) =>
        current?.rootId === rootId ? null : current,
      );
      setPluginVersion((v) => v + 1);
      if (rootId === currentRootIdRef.current) {
        void ensurePluginsLoaded(rootId).catch(() => {});
      }
    },
    [ensurePluginsLoaded],
  );

  const pluginHandlers = useMemo(
    () => ({
      open: async (params: Record<string, unknown>) => {
        await actionHandlers.open(params);
      },
      open_dir: async (params: Record<string, unknown>) => {
        await actionHandlers.open_dir(params);
      },
      select_session: async (params: Record<string, unknown>) => {
        const key = typeof params?.key === "string" ? params.key : "";
        if (!key) return;
        const root = currentRootIdRef.current;
        if (!root) return;
        const matched = sessions.find(
          (item) => (item.key || item.session_key) === key,
        );
        if (matched) {
          await handleSelectSession(matched);
          return;
        }
        await handleSelectSession({ key, session_key: key, root_id: root });
      },
      navigate: async (params: Record<string, unknown>) => {
        const current = readURLState();
        const nextRoot = current.root || currentRootIdRef.current || "";
        const nextPath =
          typeof params?.path === "string" ? params.path : current.file;
        const explicitCursor = normalizeCursor(params?.cursor);
        const rawQuery =
          params?.query &&
          typeof params.query === "object" &&
          !Array.isArray(params.query)
            ? (params.query as Record<string, unknown>)
            : null;

        const nextPluginQuery: Record<string, string> = {
          ...current.pluginQuery,
        };
        if (rawQuery) {
          Object.entries(rawQuery).forEach(([key, value]) => {
            if (!key) return;
            nextPluginQuery[key] = String(value);
          });
        }

        let nextCursor = current.cursor;
        if (explicitCursor !== null) {
          nextCursor = explicitCursor;
        } else if (
          typeof params?.path === "string" &&
          params.path !== current.file
        ) {
          nextCursor = 0;
        }
        if (!nextPath) {
          nextCursor = 0;
        }

        const nextState: URLState = {
          root: nextRoot || "",
          file: nextPath || "",
          session: "",
          cursor: nextCursor,
          pluginQuery: nextPluginQuery,
        };
        replaceURLState(nextState);
        if (nextState.file) {
          persistPluginQuery(
            nextState.root,
            nextState.file,
            nextState.pluginQuery,
          );
        }

        const rootChanged =
          (nextState.root || "") !== (currentRootIdRef.current || "");
        const fileChanged =
          (nextState.file || "") !== (fileRef.current?.path || "");
        const pluginChanged =
          JSON.stringify(nextState.pluginQuery) !==
          JSON.stringify(current.pluginQuery);

        if (pluginChanged) {
          setPluginQuery(nextState.pluginQuery);
        }

        if (!nextState.file) {
          if (nextState.root) {
            await actionHandlers.open_dir({
              path: nextState.root,
              root: nextState.root,
              preservePluginQuery: true,
              isRoot: true,
            });
          }
          return;
        }

        const cursorChanged = nextState.cursor !== fileCursorRef.current;
        if (rootChanged || fileChanged || cursorChanged) {
          await actionHandlers.open({
            path: nextState.file,
            root: nextState.root,
            cursor: nextState.cursor,
            preservePluginQuery: true,
          });
        }
      },
    }),
    [actionHandlers, sessions, handleSelectSession, replaceURLState],
  );

  const handleSessionChipClick = useCallback(
    (sessionKey: string, rootOverride?: string | null) => {
      if (!sessionKey) return;
      const root = rootOverride || file?.root || currentRootIdRef.current;
      if (!root) return;
      const matched = sessions.find((item) => {
        const key = item.key || item.session_key;
        return key === sessionKey;
      });
      if (matched) {
        handleSelectSession(matched);
        return;
      }
      handleSelectSession({
        key: sessionKey,
        session_key: sessionKey,
        root_id: root,
      });
    },
    [file, sessions, handleSelectSession],
  );

  useEffect(() => {
    function openReplySession(detail: any) {
      const rootId =
        typeof detail?.rootId === "string" ? detail.rootId.trim() : "";
      const sessionKey =
        typeof detail?.sessionKey === "string" ? detail.sessionKey.trim() : "";
      if (!rootId || !sessionKey) {
        return;
      }
      handleSessionChipClick(sessionKey, rootId);
    }

    function handleOpenReplySession(event: Event) {
      openReplySession((event as CustomEvent).detail);
    }

    window.addEventListener(
      "mindfs:open-reply-session",
      handleOpenReplySession,
    );
    openReplySession((window as any).__mindfsPendingReplySession);
    delete (window as any).__mindfsPendingReplySession;
    return () => {
      window.removeEventListener(
        "mindfs:open-reply-session",
        handleOpenReplySession,
      );
    };
  }, [handleSessionChipClick]);

  const handleFileViewerPathClick = useCallback(
    (path: string) => {
      if (!file) return;
      const root = file.root || currentRootIdRef.current;
      if (!root) return;
      actionHandlers.open_dir({
        path: path === "." ? root : path,
        root,
        isRoot: path === ".",
        suppressTreeExpand: path === ".",
      });
    },
    [file, actionHandlers],
  );

  const handleFileViewerFileClick = useCallback(
    (path: string) => {
      if (!file) return;
      const root = file.root || currentRootIdRef.current;
      if (!root) return;
      actionHandlers.open({ path, root });
    },
    [file, actionHandlers],
  );

  const handleGitDiffPathClick = useCallback(
    (path: string) => {
      const root = currentRootIdRef.current;
      if (!root) return;
      setGitDiff(null);
      actionHandlers.open_dir({
        path: path === "." ? root : path,
        root,
        isRoot: path === ".",
        suppressTreeExpand: path === ".",
      });
    },
    [actionHandlers],
  );

  const handleDirectoryPathClick = useCallback(
    (path: string) => {
      const root = currentRootIdRef.current;
      if (!root) return;
      actionHandlers.open_dir({
        path: path === "." ? root : path,
        root,
        isRoot: path === ".",
        suppressTreeExpand: path === ".",
      });
    },
    [actionHandlers],
  );

  const visibleMainEntries = useMemo(
    () =>
      showHiddenFiles
        ? mainEntries
        : mainEntries.filter((entry) => !entry.name.startsWith(".")),
    [mainEntries, showHiddenFiles],
  );

  const gitFileStatsByPath = useMemo<Record<string, GitFileStat>>(() => {
    const items = gitStatus?.items || [];
    return Object.fromEntries(
      items.map((item) => [
        item.path,
        {
          status: item.status,
          additions: item.additions,
          deletions: item.deletions,
        },
      ]),
    );
  }, [gitStatus]);

  useEffect(() => {
    if (!currentRootId) return;
    sessionService.connect(currentRootId);
  }, [currentRootId]);

  useEffect(() => {
    if (sessionListMode !== "import") return;
    const rootID = currentRootIdRef.current || "";
    if (!rootID || !externalImportAgent) return;
    setSelectedExternalImportKeys(new Set());
    void loadExternalSessions(rootID, externalImportAgent, { replace: true });
  }, [
    sessionListMode,
    externalImportAgent,
    externalFilterBound,
    loadExternalSessions,
  ]);

  useEffect(
    () => () => {
      sessionService.disconnect();
      setStatus("disconnected");
    },
    [],
  );

  useEffect(() => {
    if (!currentRootId) {
      setGitStatus(null);
      setGitHistory(null);
      setGitDiff(null);
      setSessionListMode("local");
      setExternalSessions([]);
      setExternalSelectedKey("");
      return;
    }
    void refreshGitStatus(currentRootId);
    void refreshGitHistory(currentRootId);
    setGitDiff(null);
  }, [currentRootId, refreshGitHistory, refreshGitStatus]);

  useEffect(() => {
    if (!currentRootId) return;
    let cancelled = false;
    const {
      advanceTurnVersion,
      reloadSessionForReplay,
      replayTargetsForAllRoots,
      refreshSessionRelatedFiles,
    } = createSessionReplay({
      rootSessionKey,
      isCancelled: () => cancelled,
      sessionCacheRef,
      loadingSessionRef,
      restoreActiveSession,
      loadedSessionRef,
      clearSessionStale,
      selectedSessionRef,
      setSelectedSession,
      boundSessionByRootRef,
      setDrawerSessionForRoot,
      selectedSessionByRootRef,
      drawerSessionByRootRef,
      currentRootIdRef,
      managedRootIdsRef,
      markSessionStale,
      updateSessionRelatedFilesForKey,
    });

    const { handleSessionStreamDone, handleSessionStream } =
      createSessionStreamHandlers({
        rootSessionKey,
        cancelRequestedBySessionRef,
        pendingBySessionRef,
        queuedMessagesBySessionRef,
        queueFrozenBySessionRef,
        optimisticDequeuedIdsRef,
        markSessionPending,
        sessionCacheRef,
        setSelectedPendingByKey,
        setSelectedSession,
        currentRootIdRef,
        drawerSessionByRootRef,
        setDrawerSessionForRoot,
        setSessions,
        setMultiProjectSessionPending,
        bumpCacheVersion,
        resolveRootForSessionKey,
        pendingDraftRef,
        suppressedAutoBindSessionByRootRef,
        boundSessionByRootRef,
        setBoundSessionForRoot,
        selectedSessionRef,
        t,
        promotePendingSessionForRoot,
        appendAgentChunkForSession,
        appendThoughtChunkForSession,
        appendToolCallForSession,
        appendTodoUpdateForSession,
        appendPlanUpdateForSession,
        appendCompactNoticeForSession,
        attachContextWindowToLatestAssistant,
      });

    const { handleSlashCommandStream, handleSlashCommandDone } =
      createSlashCommandHandlers({
        resolveRootForSessionKey,
        currentRootIdRef,
        rootSessionKey,
        setSlashCommandResults,
        t,
      });

    const { handleFileChangedBatch, handleFileChanged } =
      createFileChangeHandlers({
        selectedDirRef,
        invalidatePluginsForRoot,
        fileRef,
        currentRootIdRef,
        refreshCurrentFileContent,
        refreshGitStatus,
        setGitDiff,
        gitDiff,
        invalidTreeCacheKeysRef,
        treeCacheKey,
        refreshTreeDir,
      });

    const handleSessionLifecycle = createSessionLifecycleHandler({
      currentRootIdRef,
      loadSessionsForRoot,
      sessionListModeRef,
      externalImportAgentRef,
      setImportingExternalSessionKeys,
      setSelectedExternalImportKeys,
      setConfirmingExternalImport,
      loadExternalSessions,
      multiProjectSessionsEnabled,
      loadMultiProjectSessionGroups,
      rootSessionKey,
      optimisticDequeuedIdsRef,
      queueFrozenBySessionRef,
      queuedMessagesBySessionRef,
      setQueueVersion,
      pendingRequestRef,
      pendingBySessionRef,
      setMultiProjectSessionPending,
      pendingDraftRef,
      promotePendingSessionForRoot,
      sessionCacheRef,
      bumpCacheVersion,
      drawerSessionByRootRef,
      setDrawerSessionForRoot,
      resolveRootForSessionKey,
      playCompletionSound,
      handleSessionStreamDone,
      advanceTurnVersion,
      reloadSessionForReplay,
      isCancelled: () => cancelled,
      markSessionStale,
      sessionsRef,
      refreshMultiProjectReplyingSessions,
      currentSessionRef,
      selectedSessionRef,
      t,
      updateSessionAgentForKey,
      setSelectedSession,
      boundSessionByRootRef,
      refreshRelatedWorktree,
      refreshSessionRelatedFiles,
      updateSessionRelatedWorktreeForKey,
    });
    const handleWorkspaceEvent = createWorkspaceEventHandler({
      applyManagedRootRename,
      currentRootIdRef,
      onOpenProject: openProject,
      refreshManagedRoots,
      setAgentsVersion,
      setUpdateState,
    });
    const handleConnectionEvent = createConnectionEventHandler({
      setStatus,
      setAgentsVersion,
      refreshManagedRoots,
      currentRootIdRef,
      sessionsRef,
      loadSessionsForRoot,
      multiProjectSessionsEnabled,
      refreshMultiProjectReplyingSessions,
      loadMultiProjectSessionGroups,
      replayTargetsForAllRoots,
      handleRelayWebSocketClosed,
    });
    const unsubscribeEvents = sessionService.subscribeEvents((event) => {
      const payload = (event.payload || {}) as any;
      switch (event.type) {
        case "ws.connecting":
        case "ws.connected":
        case "ws.reconnecting":
        case "ws.reconnected":
        case "ws.closed":
          handleConnectionEvent(event);
          break;

        case "root.changed":
        case "agent.status.changed":
        case "app.update":
        case "github.import":
          handleWorkspaceEvent(event);
          break;
        case "session.imported":
        case "session.created":
        case "session.queue.updated":
        case "session.accepted":
        case "session.error":
        case "session.done":
        case "session.user_message":
        case "session.meta.updated":
        case "session.related_files.updated":
          handleSessionLifecycle(event);
          break;

        case "session.stream":
          handleSessionStream(payload);
          break;
        case "session.slash_command.stream":
          handleSlashCommandStream(payload);
          break;
        case "session.slash_command.done":
          handleSlashCommandDone(payload);
          break;

        case "file.changed.batch":
          handleFileChangedBatch(payload);
          break;
        case "file.changed":
          handleFileChanged(payload);
          break;
      }
    });
    void loadSessionsForRoot(currentRootId, { replace: true });
    return () => {
      cancelled = true;
      unsubscribeEvents();
    };
  }, [
    currentRootId,
    loadExternalSessions,
    loadMultiProjectSessionGroups,
    loadSessionsForRoot,
    multiProjectSessionsEnabled,
    refreshMultiProjectReplyingSessions,
    rootSessionKey,
    resolveRootForSessionKey,
    promotePendingSessionForRoot,
    appendAgentChunkForSession,
    appendThoughtChunkForSession,
    appendToolCallForSession,
    appendTodoUpdateForSession,
    appendPlanUpdateForSession,
    appendCompactNoticeForSession,
    clearSessionStale,
    markSessionPending,
    markSessionStale,
    resolvePendingForSession,
    setSelectedPendingByKey,
    setBoundSessionForRoot,
    setDrawerSessionForRoot,
    setMultiProjectSessionPending,
    refreshManagedRoots,
    handleRelayWebSocketClosed,
    invalidatePluginsForRoot,
    refreshTreeDir,
    refreshCurrentFileContent,
    refreshGitStatus,
    refreshManagedRoots,
    updateSessionRelatedWorktreeForKey,
    updateSessionRelatedFilesForKey,
    updateSessionAgentForKey,
    treeCacheKey,
    t,
  ]);

  useEffect(() => {
    if (!currentRootId) return;
    if (pluginsLoadedByRootRef.current[currentRootId]) return;
    void ensurePluginsLoaded(currentRootId).catch(() => {});
  }, [currentRootId, ensurePluginsLoaded]);

  const handleLoadOlderSessions = useCallback(async () => {
    const rootID = currentRootIdRef.current;
    const oldest =
      sessionsRef.current[sessionsRef.current.length - 1]?.updated_at || "";
    if (!rootID || !oldest || loadingOlderSessions) {
      return;
    }
    setLoadingOlderSessions(true);
    try {
      const payload = await sessionService.fetchSessions(rootID, {
        beforeTime: oldest,
      });
      const next = [...payload.items, ...payload.pinnedItems]
        .map((item) => toSessionItem(rootID, item))
        .filter((item): item is SessionItem => !!item);
      setHasMoreSessions(payload.totalCount > payload.items.length);
      setSessions((prev) =>
        applyPinnedSnapshotToSessions(
          mergeSessionItems(prev, next),
          rootID,
          payload.pinnedKeys,
        ),
      );
    } finally {
      setLoadingOlderSessions(false);
    }
  }, [loadingOlderSessions]);

  useEffect(() => {
    if (didInitRef.current || bootstrapState.phase === "error") {
      return;
    }
    didInitRef.current = true;
    let cancelled = false;
    let settled = false;
    if (isRelayPWAContext() && !isRelayNodePage()) {
      const lastNodeID = projectStorage().getItem(
        RELAY_LAST_NODE_ID_STORAGE_KEY,
      );
      if (lastNodeID) {
        window.location.replace(`/n/${lastNodeID}/`);
        return;
      }
    }
    void (async () => {
      try {
        const bootstrap = await bootstrapService.start();
        if (bootstrap.phase !== "ready") {
          didInitRef.current = false;
          return;
        }
        const dirs = await loadManagedRootPayloads();
        if (!dirs) {
          return;
        }
        if (cancelled || !dirs.length) {
          return;
        }
        const nextDirs = dirs as ManagedRootPayload[];
        syncRelayNodesToNative(nextDirs);
        const ids = nextDirs.map((d) => d.id);
        managedRootByIdRef.current = Object.fromEntries(
          nextDirs.filter((dir) => !!dir.id).map((dir) => [dir.id, dir]),
        );
        managedRootIdsRef.current = new Set(ids);
        setManagedRootIds(ids);
        setRootEntries(mapManagedRootsToEntries(nextDirs));
        const urlState = readURLState();
        const lastRoot = loadLastRootId();
        const preferredRoot =
          urlState.root && ids.includes(urlState.root)
            ? urlState.root
            : lastRoot && ids.includes(lastRoot)
              ? lastRoot
              : ids[0];
        setCurrentRootId(preferredRoot);
        setPluginQuery(urlState.pluginQuery);
        if (urlState.session) {
          if (cancelled) return;
          await handleSelectSessionRef.current?.({
            key: urlState.session,
            session_key: urlState.session,
            root_id: preferredRoot,
          });
        } else if (urlState.file) {
          await ensurePluginsLoaded(preferredRoot);
          if (cancelled) return;
          actionHandlersRef.current.open({
            path: urlState.file,
            root: preferredRoot,
            cursor: urlState.cursor,
            preservePluginQuery: true,
          });
        } else {
          const restored = await tryShowBoundSessionForRoot(preferredRoot, {
            pluginQuery: urlState.pluginQuery,
          });
          if (!restored) {
            actionHandlersRef.current.open_dir({
              path: preferredRoot,
              root: preferredRoot,
              preservePluginQuery: true,
              isRoot: true,
            });
          } else {
            void loadSessionsForRoot(preferredRoot, {
              replace: true,
              force: true,
            });
            await refreshTreeDir(preferredRoot, ".", false);
          }
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        reportError(
          "app.init_failed",
          String((err as Error)?.message || err || t("app.initFailed")),
        );
      } finally {
        settled = true;
      }
    })();
    return () => {
      cancelled = true;
      if (!settled) {
        didInitRef.current = false;
      }
    };
  }, [
    ensurePluginsLoaded,
    handleRelayNavigationFailure,
    loadManagedRootPayloads,
    loadSessionsForRoot,
    refreshTreeDir,
    tryShowBoundSessionForRoot,
    bootstrapState.phase,
  ]);

  useEffect(() => {
    return bootstrapService.subscribe((state) => {
      setBootstrapState(state);
      setRelayStatus(state.relayStatus);
      setE2eeState(state.e2ee);
    });
  }, []);

  useEffect(() => {
    document.title = formatDocumentTitle(relayStatus);
  }, [relayStatus]);

  useEffect(() => {
    return e2eeService.subscribe((state) => {
      setE2eeState(state);
    });
  }, []);

  useEffect(() => {
    void syncNativeReplyPollerE2EE().catch((err) => {
      console.warn("[ReplyPoller] Failed to sync E2EE state:", err);
    });
  }, [e2eeState.nodeId, e2eeState.required, e2eeState.unlocked]);

  useEffect(() => {
    if (bootstrapState.phase !== "ready") {
      return;
    }
    setAgentsVersion((v) => v + 1);
    if (multiProjectSessionsEnabled) {
      void loadMultiProjectSessionGroups();
    }
  }, [
    bootstrapState.phase,
    loadMultiProjectSessionGroups,
    multiProjectSessionsEnabled,
  ]);

  useEffect(() => {
    if (!isRelayPWAContext()) {
      return;
    }
    const nodeID = relayNodeIdFromPathname(window.location.pathname);
    if (!nodeID) {
      return;
    }
    projectStorage().setItem(RELAY_LAST_NODE_ID_STORAGE_KEY, nodeID);
  }, []);

  useEffect(() => {
    function handlePopState() {
      const state = readURLState();
      if (state.root) {
        setCurrentRootId(state.root);
      }
      setPluginQuery(state.pluginQuery);
      if (!state.root) {
        return;
      }
      if (state.session) {
        const currentSessionKey =
          selectedSessionRef.current?.key ||
          selectedSessionRef.current?.session_key ||
          "";
        const currentSessionRoot =
          (selectedSessionRef.current?.root_id as string | undefined) ||
          currentRootIdRef.current ||
          "";
        if (
          state.session !== currentSessionKey ||
          state.root !== currentSessionRoot
        ) {
          void handleSelectSessionRef.current?.({
            key: state.session,
            session_key: state.session,
            root_id: state.root,
          });
        }
        return;
      }
      if (state.file) {
        const currentPath = fileRef.current?.path || "";
        const currentRoot = currentRootIdRef.current || "";
        const currentCursor = fileCursorRef.current;
        if (
          state.file !== currentPath ||
          state.root !== currentRoot ||
          state.cursor !== currentCursor
        ) {
          actionHandlers.open({
            path: state.file,
            root: state.root,
            cursor: state.cursor,
            preservePluginQuery: true,
          });
        }
        return;
      }
      void (async () => {
        const restored = await tryShowBoundSessionForRoot(state.root, {
          pluginQuery: state.pluginQuery,
        });
        if (restored) {
          void loadSessionsForRoot(state.root, { replace: true, force: true });
          await refreshTreeDir(state.root, ".", false);
          return;
        }
        actionHandlers.open_dir({
          path: state.root,
          root: state.root,
          preservePluginQuery: true,
          isRoot: true,
        });
      })();
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [
    actionHandlers,
    loadSessionsForRoot,
    refreshTreeDir,
    tryShowBoundSessionForRoot,
  ]);

  const selectedRoot =
    (selectedSession?.root_id as string | undefined) || currentRootId || "";
  const selectedInCurrentRoot =
    !!selectedSession && !!currentRootId && selectedRoot === currentRootId;
  const selectedKey =
    selectedSession?.key || selectedSession?.session_key || "";
  const boundFromSelected =
    selectedInCurrentRoot && selectedKey === activeBoundSessionKey
      ? (selectedSession as any)
      : null;
  const boundFromCache =
    activeBoundSessionKey && currentRootId
      ? (sessionCacheRef.current[
          rootSessionKey(currentRootId, activeBoundSessionKey)
        ] as any)
      : null;
  const isDetachedMainSessionTarget =
    !!activeBoundSessionKey &&
    selectedInCurrentRoot &&
    !!selectedKey &&
    selectedKey !== activeBoundSessionKey &&
    interactionMode !== "drawer";
  const boundFromCurrent =
    activeBoundSessionKey &&
    (currentSession?.key || currentSession?.session_key) ===
      activeBoundSessionKey &&
    (!currentSession?.root_id || currentSession.root_id === currentRootId)
      ? currentSession
      : null;
  // Match the same main/drawer target used by handleSendMessage, even while
  // a previously bound drawer is being replaced or receiving background events.
  const actionBarSession =
    selectedInCurrentRoot && interactionMode !== "drawer"
      ? selectedSession
      : activeBoundSessionKey
        ? boundFromCurrent || boundFromCache || boundFromSelected
        : null;
  const actionBarSessionKey =
    (actionBarSession as any)?.key ||
    (actionBarSession as any)?.session_key ||
    "";
  const actionBarInputHistory = sessionInputHistory(
    getSessionSnapshot(
      ((actionBarSession as any)?.root_id as string | undefined) ||
        currentRootId,
      actionBarSession as any,
    ) || (actionBarSession as any),
  );
  const isBoundSessionInMain =
    !!activeBoundSessionKey &&
    selectedKey === activeBoundSessionKey &&
    interactionMode !== "drawer";
  const canOpenSessionDrawer = !!activeBoundSessionKey && !isBoundSessionInMain;
  const detachedBoundSession = isDetachedMainSessionTarget && !isDrawerOpen;
  const actionBarQueuedMessages = useMemo(() => {
    void queueVersion;
    if (!currentRootId || !actionBarSessionKey) return [];
    return (
      queuedMessagesBySessionRef.current[
        rootSessionKey(currentRootId, actionBarSessionKey)
      ] || []
    );
  }, [actionBarSessionKey, currentRootId, queueVersion, rootSessionKey]);

  const matchedPlugin = useMemo(() => {
    if (!currentRootId || !file) return null;
    const input = toPluginInput(file, pluginQuery);
    return pluginManagerRef.current.match(currentRootId, input);
  }, [currentRootId, file, pluginVersion, pluginQuery]);

  useEffect(() => {
    if (!file || pluginBypass || !matchedPlugin) return;
    if (inferReadModeFromPlugin(matchedPlugin) !== "full") return;
    if (!file.truncated) return;
    const root = file.root || currentRootId;
    if (!root) return;
    const upgradeKey = `${root}:${file.path}:${matchedPlugin.name}:${JSON.stringify(pluginQuery)}`;
    if (fullUpgradeAttemptRef.current === upgradeKey) return;
    fullUpgradeAttemptRef.current = upgradeKey;
    void actionHandlers.open({
      path: file.path,
      root,
      cursor: fileCursorRef.current || 0,
      readMode: "full",
      preservePluginQuery: true,
    });
  }, [
    file,
    pluginBypass,
    matchedPlugin,
    currentRootId,
    pluginQuery,
    actionHandlers,
  ]);

  const pluginRender = useMemo(() => {
    if (!file || pluginBypass || !matchedPlugin) return null;
    const input = toPluginInput(file, pluginQuery);
    try {
      const output = pluginManagerRef.current.run(matchedPlugin, input);
      return { plugin: matchedPlugin, output, error: "" };
    } catch (err: any) {
      return {
        plugin: matchedPlugin,
        output: null,
        error: String(err?.message || err || "plugin process failed"),
      };
    }
  }, [file, pluginBypass, matchedPlugin, pluginQuery]);

  useEffect(() => {
    if (!file || pluginBypass || !pluginRender?.output) {
      return;
    }
    const handleSelectionChange = () => {
      const root = pluginContentRef.current;
      const selection = window.getSelection();
      if (
        !root ||
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed
      ) {
        handleViewerSelectionChange(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const commonAncestor = range.commonAncestorContainer;
      if (!root.contains(commonAncestor)) {
        handleViewerSelectionChange(null);
        return;
      }
      const text = selection.toString();
      if (!text.trim()) {
        handleViewerSelectionChange(null);
        return;
      }
      handleViewerSelectionChange({
        filePath: file.path,
        text,
      });
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      handleViewerSelectionChange(null);
    };
  }, [file, pluginBypass, pluginRender?.output, handleViewerSelectionChange]);

  useEffect(() => {
    if (!file || pluginBypass || !pluginRender?.output) {
      lastPluginChapterRef.current = "";
      return;
    }
    const chapterKey = `${file.path}:${pluginQuery.chapter || "1"}`;
    if (!lastPluginChapterRef.current) {
      lastPluginChapterRef.current = chapterKey;
      return;
    }
    if (lastPluginChapterRef.current === chapterKey) {
      return;
    }
    lastPluginChapterRef.current = chapterKey;
    requestAnimationFrame(() => {
      pluginContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [file, pluginBypass, pluginRender?.output, pluginQuery.chapter]);

  const pluginRendererKey = `${currentRootId || ""}:${file?.path || ""}:${fileCursorRef.current}:${JSON.stringify(pluginQuery)}`;
  const pluginThemeVars = useMemo(() => {
    const theme = pluginRender?.plugin?.theme;
    if (!theme) return null;
    return {
      "--vp-overlay-bg": theme.overlayBg,
      "--vp-surface-bg": theme.surfaceBg,
      "--vp-surface-bg-elevated": theme.surfaceBgElevated,
      "--vp-text": theme.text,
      "--vp-text-muted": theme.textMuted,
      "--vp-border": theme.border,
      "--vp-primary": theme.primary,
      "--vp-primary-text": theme.primaryText,
      "--vp-radius": theme.radius,
      "--vp-shadow": theme.shadow,
      "--vp-focus-ring": theme.focusRing,
      "--vp-danger": theme.danger,
      "--vp-warning": theme.warning,
      "--vp-success": theme.success,
    } as React.CSSProperties;
  }, [pluginRender]);

  const selectedSessionSnapshot = useMemo(() => {
    if (!selectedSession) {
      return null;
    }
    return getSessionSnapshot(
      selectedSession.root_id || currentRootId,
      selectedSession,
    );
  }, [
    selectedSession,
    selectedSessionLoading,
    currentRootId,
    getSessionSnapshot,
  ]);
  const sessionByKey = useMemo(
    () =>
      sessions.reduce<Record<string, SessionItem>>((acc, session) => {
        const key = session.key || session.session_key || "";
        if (key) acc[key] = session;
        return acc;
      }, {}),
    [sessions],
  );

  useEffect(() => {
    if (selectedSessionSnapshot) {
      lastMainSessionSnapshotRef.current = selectedSessionSnapshot as Session;
    }
  }, [selectedSessionSnapshot]);

  useEffect(() => {
    const sessionKey =
      selectedSession?.key || selectedSession?.session_key || "";
    const rootID =
      (selectedSession?.root_id as string | undefined) || currentRootId || "";
    if (!rootID || !sessionKey || sessionKey.startsWith("pending-")) {
      return;
    }
    if (selectedSessionLoading) {
      return;
    }
    const cacheKey = rootSessionKey(rootID, sessionKey);
    const isStale = isSessionStale(rootID, sessionKey);
    const cached = sessionCacheRef.current[cacheKey];
    if (!isStale && loadedSessionRef.current[cacheKey]) {
      return;
    }
    if (
      !isStale &&
      hasSessionExchanges(cached) &&
      hasCurrentActivityHistory(cached)
    ) {
      return;
    }
    if (
      !isStale &&
      hasSessionExchanges(selectedSessionSnapshot as Session | null) &&
      hasCurrentActivityHistory(selectedSessionSnapshot as Session | null)
    ) {
      return;
    }
    if (loadingSessionRef.current[cacheKey]) {
      return;
    }
    void restoreActiveSession(rootID, sessionKey).then((restored) => {
      if (!restored) {
        return;
      }
      loadedSessionRef.current[cacheKey] = true;
      clearSessionStale(rootID, sessionKey);
      setSelectedSession((prev) => {
        const prevKey = prev?.key || prev?.session_key;
        const prevRoot =
          (prev?.root_id as string | undefined) || currentRootIdRef.current;
        if (!prev || prevKey !== sessionKey || prevRoot !== rootID) {
          return prev;
        }
        return toSessionItem(rootID, {
          ...(prev as any),
          ...(restored as any),
          key: sessionKey,
          session_key: sessionKey,
          root_id: rootID,
        });
      });
      if (boundSessionByRootRef.current[rootID] === sessionKey) {
        setDrawerSessionForRoot(rootID, restored);
      }
    });
  }, [
    selectedSession,
    selectedSessionLoading,
    selectedSessionSnapshot,
    currentRootId,
    rootSessionKey,
    bumpCacheVersion,
    clearSessionStale,
    isSessionStale,
    resolvePendingForSession,
    restoreActiveSession,
    setDrawerSessionForRoot,
  ]);

  useEffect(() => {
    if (isIdeaRuntime) return;
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ root: string; path: string }>)
        .detail;
      actionHandlers.open(detail);
    };
    window.addEventListener("ideaRemoteOpenFile", open);
    return () => window.removeEventListener("ideaRemoteOpenFile", open);
  }, [actionHandlers]);

  const handleSelectedSessionFileClick = useCallback(
    (target: string | RelatedFileClickTarget) => {
      const root =
        (selectedSessionRef.current?.root_id as string | undefined) ||
        currentRootIdRef.current;
      if (!root) return;
      const file = typeof target === "string" ? { path: target } : target;
      if (isIdeaRuntime) {
        openIdeaFile(root, file.path);
        return;
      }
      setProjectTreeTabRequest((prev) => ({
        tab: "related",
        nonce: (prev?.nonce || 0) + 1,
      }));
      setExpanded((prev) => Array.from(new Set([...prev, root])));
      void openRelatedFileDiff(root, file);
    },
    [openRelatedFileDiff],
  );

  const drawerSessionSnapshot = useMemo(
    () =>
      currentSession ? getSessionSnapshot(currentRootId, currentSession) : null,
    [currentSession, currentRootId, getSessionSnapshot],
  );

  const ideaUserMessageSummaries = useMemo(() => {
    const source = selectedSessionSnapshot || drawerSessionSnapshot;
    const items = buildBaseTimeline(
      source?.exchanges || [],
      source?.exchange_aux || {},
    );
    return items.flatMap(
      (
        item,
        index,
      ): {
        id: string;
        seq: number;
        summary: string;
      }[] => {
        if (item.type !== "user_text") return [];
        const text = item.content
          .replace(/\[(?:read file|file):\s*[^\]]+\]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 48);
        return [
          {
            id: item.id || `idea-user-${index}`,
            seq: Number(item.seq || index + 1),
            summary: text || t("session.emptyMessage"),
          },
        ];
      },
    );
  }, [selectedSessionSnapshot, drawerSessionSnapshot, t]);

  const rootSessionIndicators = useMemo(() => {
    const next: Record<string, { bound?: boolean; pending?: boolean }> = {};
    for (const root of managedRootIds) {
      const boundKey = String(boundSessionByRootRef.current[root] || "").trim();
      const hasBound = !!boundKey && !boundKey.startsWith("pending-");
      const pendingPrefix = rootSessionKey(root, "");
      const hasPendingSession = Object.entries(multiProjectPendingByKey).some(
        ([key, pending]) => pending && key.startsWith(pendingPrefix),
      );
      if (!hasBound && !hasPendingSession) {
        continue;
      }
      const drawer = drawerSessionByRootRef.current[root] as
        | (Session & { pending?: boolean })
        | null
        | undefined;
      const selected =
        ((selectedSession?.root_id as string | undefined) || currentRootId) ===
          root &&
        (selectedSession?.key || selectedSession?.session_key) === boundKey
          ? (selectedSession as any as { pending?: boolean })
          : null;
      const pending =
        hasPendingSession ||
        (drawer?.key === boundKey && !!drawer?.pending) ||
        !!selected?.pending;
      next[root] = { bound: hasBound || hasPendingSession, pending };
    }
    return next;
  }, [
    managedRootIds,
    selectedSession,
    currentSession,
    currentRootId,
    activeBoundSessionKey,
    cacheVersion,
    multiProjectPendingByKey,
    rootSessionKey,
  ]);

  const handleDrawerSessionFileClick = useCallback(
    (target: string | RelatedFileClickTarget) => {
      const root = currentRootIdRef.current;
      if (!root) return;
      const file = typeof target === "string" ? { path: target } : target;
      if (isIdeaRuntime) {
        openIdeaFile(root, file.path);
        return;
      }
      void openRelatedFileDiff(root, file);
    },
    [openRelatedFileDiff],
  );

  const handleRemoveSessionRelatedFile = useCallback(
    async (
      rootID: string | null | undefined,
      sessionKey: string | undefined,
      path: string,
      head = "",
      repoPath = "",
      repoKind = "",
    ) => {
      const resolvedRoot = rootID || currentRootIdRef.current;
      const resolvedKey = sessionKey || "";
      if (!resolvedRoot || !resolvedKey || !path) return;
      const removed = await sessionService.removeSessionRelatedFile(
        resolvedRoot,
        resolvedKey,
        path,
        head,
        repoPath,
        repoKind,
      );
      if (!removed) return;
      const relatedFiles = await sessionService.getSessionRelatedFiles(
        resolvedRoot,
        resolvedKey,
      );
      await setCachedSessionRelatedFiles(
        resolvedRoot,
        resolvedKey,
        relatedFiles,
      );
      updateSessionRelatedFilesForKey(resolvedRoot, resolvedKey, relatedFiles);
    },
    [updateSessionRelatedFilesForKey],
  );

  const handleAskUserAnswer = useCallback(
    async (input: {
      rootId: string;
      sessionKey: string;
      agent?: string;
      toolUseId: string;
      answers: Record<string, string>;
    }) => {
      await sessionService.answerQuestion(
        input.rootId,
        input.sessionKey,
        input.agent,
        input.toolUseId,
        input.answers,
      );
    },
    [],
  );

  // The child session of a running subagent records the call that started it.
  const handleOpenSubagent = useCallback(
    async (rootID: string, parentKey: string, subagent: RunningSubagent) => {
      if (!rootID || !parentKey) return;
      const find = (items: SessionItem[]) =>
        items.find(
          (item) =>
            item.parent_session_key === parentKey &&
            [subagent.callId, subagent.stopRef].includes(item.parent_tool_call_id || ""),
        );
      let child = find(sessionsRef.current);
      if (!child) {
        const fetched = await sessionService.fetchChildSessions(rootID, parentKey, {
          limit: CHILD_SESSION_PAGE_SIZE,
        });
        const items = fetched
          .map((item) => toSessionItem(rootID, item))
          .filter((item): item is SessionItem => !!item);
        if (items.length > 0) setSessions((prev) => mergeSessionItems(prev, items));
        child = find(items);
      }
      if (!child) {
        reportError("session.sync_failed", t("session.subagentNotReady"));
        return;
      }
      await handleSelectSession(child);
    },
    [handleSelectSession, t],
  );

  const handleStopSubagent = useCallback(
    async (rootID: string, parentKey: string, subagent: RunningSubagent) => {
      if (!rootID || !parentKey) return;
      try {
        await sessionService.stopTask(rootID, parentKey, subagent.stopRef);
      } catch (error) {
        reportError(
          "session.sync_failed",
          t("session.subagentStopFailed", {
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [t],
  );

  const handleEditUserMessage = useCallback((content: string) => {
    setEditDraftRequest((prev) => ({
      id: (prev?.id || 0) + 1,
      content,
    }));
  }, []);

  const currentFileScrollKey = buildFileScrollKey(
    file?.root || currentRootId,
    file?.path,
  );
  const slashCommandResultForSession = (
    rootID: string | null | undefined,
    session: { key?: string; session_key?: string } | null | undefined,
  ) => {
    const sessionKey = session?.key || session?.session_key || "";
    const resolvedRoot = rootID || "";
    if (!resolvedRoot) {
      return null;
    }
    if (!sessionKey) {
      let best: SlashCommandResult | null = null;
      for (const value of Object.values(slashCommandResults)) {
        if (
          value.rootId !== resolvedRoot ||
          !value.sessionKey.startsWith("transient-")
        ) {
          continue;
        }
        if (!best || (value.createdAt || 0) > (best.createdAt || 0)) {
          best = value;
        }
      }
      return best;
    }
    return (
      slashCommandResults[rootSessionKey(resolvedRoot, sessionKey)] || null
    );
  };
  const renderRootSlashCommandResult = (result: SlashCommandResult | null) => {
    if (!result || !result.sessionKey.startsWith("transient-")) {
      return null;
    }
    const commandLabel = `/${result.command || "status"}`;
    const loginNotice = result.loginNotice;
    const isLogin = (result.command || "") === "login";
    const fallback =
      result.status === "running"
        ? isLogin
          ? t("session.loginWaiting")
          : t("session.statusFetching")
        : "";
    const content =
      result.error || loginNotice?.error || result.content || fallback;
    const loginCodeCopyKey = loginNotice?.loginId
      ? `login-code:${loginNotice.loginId}`
      : `login-code:${result.sessionKey}`;
    const loginCodeCopied = !!copiedSlashCommandKeys[loginCodeCopyKey];
    return (
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: "1px solid rgba(148,163,184,0.36)",
          background: "rgba(148,163,184,0.10)",
          borderRadius: "8px",
          padding: "10px 12px",
          color: "var(--text-primary)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            marginBottom: content || loginNotice?.userCode ? "6px" : 0,
            fontSize: "11px",
            lineHeight: 1.4,
            color: "var(--text-secondary)",
          }}
        >
          <span
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {commandLabel}
          </span>
          <span>
            {result.status === "running"
              ? t("session.statusRunning")
              : result.status === "failed"
                ? t("session.statusFailed")
                : t("session.statusComplete")}
          </span>
        </div>
        {isLogin && loginNotice?.userCode ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              fontSize: "13px",
              lineHeight: 1.5,
            }}
          >
            {loginNotice.verificationUrl ? (
              <a
                href={loginNotice.verificationUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent)", overflowWrap: "anywhere" }}
              >
                {loginNotice.verificationUrl}
              </a>
            ) : null}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: "20px",
                  letterSpacing: "0",
                }}
              >
                {loginNotice.userCode}
              </span>
              <button
                type="button"
                onClick={() => {
                  const userCode = loginNotice.userCode || "";
                  if (!userCode) {
                    reportError(
                      "clipboard.write_failed",
                      t("session.emptyCodeCannotCopy"),
                    );
                    return;
                  }
                  void copyText(userCode)
                    .then(() => {
                      setCopiedSlashCommandKeys((prev) => ({
                        ...prev,
                        [loginCodeCopyKey]: true,
                      }));
                      if (slashCopyResetTimersRef.current[loginCodeCopyKey]) {
                        window.clearTimeout(
                          slashCopyResetTimersRef.current[loginCodeCopyKey],
                        );
                      }
                      slashCopyResetTimersRef.current[loginCodeCopyKey] =
                        window.setTimeout(() => {
                          setCopiedSlashCommandKeys((prev) => {
                            const next = { ...prev };
                            delete next[loginCodeCopyKey];
                            return next;
                          });
                          delete slashCopyResetTimersRef.current[
                            loginCodeCopyKey
                          ];
                        }, 1000);
                    })
                    .catch((err) => {
                      reportError(
                        "clipboard.write_failed",
                        String(
                          (err as Error)?.message || t("session.copyFailed"),
                        ),
                      );
                    });
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "22px",
                  height: "22px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  borderRadius: "6px",
                  padding: 0,
                  cursor: "pointer",
                }}
                aria-label={
                  loginCodeCopied
                    ? t("session.codeCopied")
                    : t("session.copyCode")
                }
                title={
                  loginCodeCopied ? t("session.copied") : t("session.copyCode")
                }
              >
                {loginCodeCopied ? (
                  <span
                    aria-hidden="true"
                    style={{ fontSize: "13px", fontWeight: 800, lineHeight: 1 }}
                  >
                    ✓
                  </span>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M20 2H10c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 12H10V4h10z"
                    />
                    <path
                      fill="currentColor"
                      d="M14 20H4V10h2V8H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-2h-2z"
                    />
                  </svg>
                )}
              </button>
            </div>
            {result.status === "complete" ? (
              <div style={{ color: "var(--text-secondary)" }}>
                {t("session.loginComplete")}
                {loginNotice.planType ? ` · ${loginNotice.planType}` : ""}
              </div>
            ) : null}
          </div>
        ) : content ? (
          <div
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {content}
          </div>
        ) : null}
      </div>
    );
  };
  const currentRootSlashCommandResult = slashCommandResultForSession(
    currentRootId,
    null,
  );
  const sessionView = (
    <SessionViewer
      connected={status === "connected"}
      session={selectedSessionSnapshot}
      agents={availableAgents}
      slashCommandResult={slashCommandResultForSession(
        selectedSession?.root_id || currentRootId,
        selectedSessionSnapshot,
      )}
      targetSeq={selectedSession?.search_seq}
      targetSeqRequestKey={selectedSession?.search_target_id}
      loading={selectedSessionLoading}
      rootId={selectedSession?.root_id || currentRootId}
      rootPath={
        managedRootByIdRef.current[
          selectedSession?.root_id || currentRootId || ""
        ]?.root_path || null
      }
      gitFileStatsByPath={gitFileStatsByPath}
      onFileClick={handleSelectedSessionFileClick}
      onRootClick={(root) => {
        void actionHandlers.open_dir({
          path: root,
          root,
          isRoot: true,
          forceDirectory: true,
          suppressTreeExpand: true,
        });
      }}
      onRemoveRelatedFile={(path, head, repoPath, repoKind) =>
        void handleRemoveSessionRelatedFile(
          selectedSession?.root_id || currentRootId,
          selectedSessionSnapshot?.key || selectedSessionSnapshot?.session_key,
          path,
          head,
          repoPath,
          repoKind,
        )
      }
      onAskUserAnswer={handleAskUserAnswer}
      onEditUserMessage={handleEditUserMessage}
      onForkAgentMessage={(seq) =>
        void handleForkAgentMessage(
          selectedSession?.root_id || currentRootId,
          selectedSessionSnapshot?.key || selectedSessionSnapshot?.session_key,
          seq,
        )
      }
      onOpenSubagent={(subagent) =>
        void handleOpenSubagent(
          selectedSession?.root_id || currentRootId || "",
          selectedSessionSnapshot?.key || selectedSessionSnapshot?.session_key || "",
          subagent,
        )
      }
      onStopSubagent={(subagent) =>
        void handleStopSubagent(
          selectedSession?.root_id || currentRootId || "",
          selectedSessionSnapshot?.key || selectedSessionSnapshot?.session_key || "",
          subagent,
        )
      }
    />
  );

  let workspaceView: React.ReactNode;
  const gitStatusAvailable = gitStatus?.available === true;
  const gitHistoryAvailable = gitHistory?.available === true;
  const gitStatusExpanded = currentRootId
    ? gitStatusExpandedByRoot[currentRootId] !== false
    : true;
  const gitHistoryExpandedCommits = currentRootId
    ? gitHistoryExpandedByRoot[currentRootId] || {}
    : {};
  const shouldRenderGitPanel = gitStatusLoading || gitStatusAvailable;
  const shouldRenderGitHistoryPanel =
    gitHistoryLoading ||
    (gitHistoryAvailable && (gitHistory?.items.length || 0) > 0);
  const activePendingPluginTrust =
    pendingPluginTrust && pendingPluginTrust.rootId === currentRootId
      ? pendingPluginTrust
      : null;
  const relatedSessionSnapshot =
    selectedSessionSnapshot ||
    drawerSessionSnapshot ||
    lastMainSessionSnapshotRef.current;
  const relatedSessionRootId =
    (relatedSessionSnapshot?.root_id as string | undefined) ||
    (selectedSession?.root_id as string | undefined) ||
    currentRootId;
  const relatedSessionKey =
    relatedSessionSnapshot?.key || relatedSessionSnapshot?.session_key;
  const relatedSelectedPath = gitDiff?.path || file?.path || "";
  const relatedWorktree = relatedSessionSnapshot?.related_worktree || null;

  const refreshProjectTreeRelatedFiles = useCallback(async () => {
    try {
      const root = relatedSessionRootId || currentRootId || "";
      const sessionKey = String(relatedSessionKey || "").trim();
      if (!root || !sessionKey) {
        return;
      }
      const relatedFiles = await sessionService.getSessionRelatedFiles(
        root,
        sessionKey,
      );
      await setCachedSessionRelatedFiles(root, sessionKey, relatedFiles);
      updateSessionRelatedFilesForKey(root, sessionKey, relatedFiles);
    } catch (error) {
      console.error("[session.related_files] manual refresh failed", { error });
    }
  }, [
    currentRootId,
    relatedSessionKey,
    relatedSessionRootId,
    updateSessionRelatedFilesForKey,
  ]);

  const handleProjectTreeRefresh = useCallback(
    async (tab: ProjectTreeTab) => {
      const root = currentRootIdRef.current;
      if (!root) {
        return;
      }
      switch (tab) {
        case "files": {
          const dir =
            selectedDirRef.current === root
              ? "."
              : selectedDirRef.current || ".";
          await refreshTreeDir(root, dir, true);
          return;
        }
        case "git":
          await Promise.all([
            refreshGitStatus(root),
            refreshGitHistory(root, { waitForIncremental: true }),
          ]);
          return;
        case "worktrees": {
          const items = await loadProjectTreeWorktrees(root);
          const expandedPath = expandedWorktreeByRoot[root] || "";
          if (
            expandedPath &&
            items.some((item) => item.path === expandedPath)
          ) {
            await loadProjectTreeWorktreeStatus(expandedPath);
          }
          return;
        }
        case "related":
          await Promise.all([
            refreshProjectTreeRelatedFiles(),
            refreshGitStatus(root),
          ]);
      }
    },
    [
      expandedWorktreeByRoot,
      loadProjectTreeWorktreeStatus,
      loadProjectTreeWorktrees,
      refreshGitHistory,
      refreshGitStatus,
      refreshProjectTreeRelatedFiles,
      refreshTreeDir,
    ],
  );

  useEffect(() => {
    const rootID = String(relatedWorktree?.root_id || "");
    const worktreePath = String(relatedWorktree?.path || "");
    if (projectTreeTab !== "worktrees" || !rootID || !worktreePath) {
      return;
    }
    setExpandedWorktreeByRoot((prev) => {
      if (prev[rootID] === worktreePath) {
        return prev;
      }
      return { ...prev, [rootID]: worktreePath };
    });
    void loadProjectTreeWorktreeStatus(worktreePath);
  }, [
    loadProjectTreeWorktreeStatus,
    projectTreeTab,
    relatedWorktree?.path,
    relatedWorktree?.root_id,
  ]);

  const renderRootWorktreeContent = (root: string): React.ReactNode => {
    const relatedPath =
      relatedWorktree?.root_id === root
        ? String(relatedWorktree?.path || "")
        : "";
    const items = [...(worktreeItemsByRoot[root] || [])].sort((left, right) => {
      if (!relatedPath) {
        return 0;
      }
      if (left.path === relatedPath) {
        return -1;
      }
      if (right.path === relatedPath) {
        return 1;
      }
      return 0;
    });
    const loading = worktreeLoadingByRoot[root] === true;
    const error = worktreeErrorByRoot[root] || "";
    const expandedPath = expandedWorktreeByRoot[root] || "";
    if (loading) {
      return (
        <div
          style={{
            padding: "8px 4px",
            fontSize: "12px",
            color: "var(--text-secondary)",
          }}
        >
          {t("worktree.loading")}
        </div>
      );
    }
    if (error) {
      return (
        <div style={{ padding: "8px 4px", fontSize: "12px", color: "#b45309" }}>
          {error}
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div
          style={{
            padding: "8px 4px",
            fontSize: "12px",
            color: "var(--text-secondary)",
          }}
        >
          {t("worktree.empty")}
        </div>
      );
    }
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "5px",
          minWidth: 0,
        }}
      >
        {items.map((item) => {
          const managed = findManagedRootByPath(item.path);
          const targetRootId = managed?.id || "";
          const selected = expandedPath === item.path;
          const status = worktreeStatusByPath[item.path] || null;
          const statusLoading = worktreeStatusLoadingByPath[item.path] === true;
          const dirtyCount = status?.items?.length || 0;
          const branchLabel =
            item.branch || item.head?.slice(0, 8) || item.path;
          const statusCountLabel = statusLoading
            ? "..."
            : status
              ? String(dirtyCount)
              : "";
          return (
            <div key={item.path} style={{ minWidth: 0 }}>
              <button
                type="button"
                onClick={async () => {
                  if (selected) {
                    setExpandedWorktreeByRoot((prev) => ({
                      ...prev,
                      [root]: "",
                    }));
                    return;
                  }
                  setExpandedWorktreeByRoot((prev) => ({
                    ...prev,
                    [root]: item.path,
                  }));
                  await loadProjectTreeWorktreeStatus(item.path);
                }}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: "7px",
                  background: selected ? "var(--selection-bg)" : "transparent",
                  color: selected
                    ? "var(--accent-color)"
                    : "var(--text-primary)",
                  padding: "6px 4px 6px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span
                    title={t("git.changes")}
                    aria-label={t("git.changes")}
                    style={{
                      width: "18px",
                      height: "18px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-primary)",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M7 5a2 2 0 1 1 3.763.945h.58a4 4 0 0 1 4 4v1.28a2 2 0 0 1-1.02 3.72a2 2 0 0 1-.98-3.745V9.945a2 2 0 0 0-2-2H10v9.323A2 2 0 0 1 9 21a2 2 0 0 1-1-3.732V6.732A2 2 0 0 1 7 5"
                      />
                    </svg>
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: selected ? 700 : 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {branchLabel}
                  </span>
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "11px",
                    color: selected
                      ? "var(--accent-color)"
                      : "var(--text-secondary)",
                    flexShrink: 0,
                  }}
                >
                  <span>{statusCountLabel}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                    style={{
                      transform: selected ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.15s",
                    }}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              </button>
              {selected ? (
                <div style={{ padding: "4px 0 4px 0" }}>
                  {statusLoading || status ? (
                    <GitStatusPanel
                      rootId={targetRootId || currentRootId || undefined}
                      status={status}
                      loading={statusLoading}
                      compact
                      expanded
                      showHeader={false}
                      showHeaderActions={false}
                      showExpandedToggle={false}
                      enableBranchMenu={false}
                      onSelectItem={(statusItem) => {
                        const nextRoot = targetRootId || root;
                        if (!nextRoot) {
                          return;
                        }
                        void openGitDiff(
                          nextRoot,
                          statusItem,
                          targetRootId ? undefined : { repoPath: item.path },
                        );
                      }}
                      onOpenItem={(statusItem) => {
                        const nextRoot = targetRootId;
                        if (!nextRoot || statusItem.is_dir === true) {
                          return;
                        }
                        actionHandlers.open({
                          path: statusItem.path,
                          root: nextRoot,
                        });
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        padding: "6px 4px",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {t("git.loadingStatusInline")}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };
  const selectedSessionRelatedFiles = useMemo(() => {
    const rawRelated =
      relatedSessionSnapshot?.related_files ||
      (relatedSessionSnapshot as any)?.outputs ||
      [];
    return (Array.isArray(rawRelated) ? rawRelated : [])
      .map(
        (
          file:
            | RelatedFile
            | string
            | {
                path?: unknown;
                name?: unknown;
                head?: unknown;
                repo_path?: unknown;
                repo_name?: unknown;
                repo_kind?: unknown;
                root_id?: unknown;
              },
        ) => {
          const path =
            typeof file === "string"
              ? file
              : typeof file?.path === "string"
                ? file.path
                : "";
          const rawName =
            typeof file !== "string" ? (file as { name?: unknown }).name : "";
          const name =
            typeof rawName === "string"
              ? rawName
              : path.split("/").pop() || path;
          const head =
            typeof file !== "string" && typeof file?.head === "string"
              ? file.head
              : "";
          const repoPath =
            typeof file !== "string" && typeof file?.repo_path === "string"
              ? file.repo_path
              : "";
          const repoName =
            typeof file !== "string" && typeof file?.repo_name === "string"
              ? file.repo_name
              : repoPath.split(/[\\/]/).filter(Boolean).pop() || "";
          const repoKind =
            typeof file !== "string" && typeof file?.repo_kind === "string"
              ? file.repo_kind
              : "";
          const rootID =
            typeof file !== "string" && typeof file?.root_id === "string"
              ? file.root_id
              : "";
          return {
            path,
            name,
            head,
            repo_path: repoPath,
            repo_name: repoName,
            repo_kind: repoKind,
            root_id: rootID,
          };
        },
      )
      .filter((file) => file.path);
  }, [relatedSessionSnapshot]);
  const selectedSessionRelatedFileGroups = useMemo(() => {
    const currentRootPath = normalizePath(
      managedRootByIdRef.current[relatedSessionRootId || currentRootId || ""]
        ?.root_path || "",
    );
    const repoGroups = selectedSessionRelatedFiles.reduce<
      Array<{
        key: string;
        repoPath: string;
        repoName: string;
        repoKind: string;
        headGroups: Array<{
          key: string;
          head: string;
          files: typeof selectedSessionRelatedFiles;
        }>;
      }>
    >((groups, file) => {
      const head = file.head || "";
      const rawRepoPath = file.repo_path || "";
      const isCurrentRepoRecord =
        !rawRepoPath ||
        file.repo_name === t("session.currentProject") ||
        (currentRootPath && normalizePath(rawRepoPath) === currentRootPath);
      const repoPath = isCurrentRepoRecord ? "" : rawRepoPath;
      const rawRepoKind = file.repo_kind || "";
      const repoKind =
        isCurrentRepoRecord && rawRepoKind !== "plain" ? "" : rawRepoKind;
      const repoKey = `${repoKind}\0${repoPath}`;
      let repoGroup = groups.find((group) => group.key === repoKey);
      if (!repoGroup) {
        repoGroup = {
          key: repoKey,
          repoPath,
          repoName: isCurrentRepoRecord
            ? t("session.currentProject")
            : file.repo_name ||
              repoPath.split(/[\\/]/).filter(Boolean).pop() ||
              t("session.currentProject"),
          repoKind,
          headGroups: [],
        };
        groups.push(repoGroup);
      }
      const headKey = `${repoKey}\0${head}`;
      const existing = repoGroup.headGroups.find(
        (group) => group.key === headKey,
      );
      if (existing) {
        existing.files.push(file);
      } else {
        repoGroup.headGroups.push({
          key: headKey,
          head,
          files: [file],
        });
      }
      return groups;
    }, []);
    return repoGroups.flatMap((repoGroup) =>
      repoGroup.headGroups.map((headGroup) => ({
        key: headGroup.key,
        head: headGroup.head,
        repoPath: repoGroup.repoPath,
        repoName: repoGroup.repoName,
        repoKind: repoGroup.repoKind,
        files: headGroup.files,
      })),
    );
  }, [currentRootId, relatedSessionRootId, selectedSessionRelatedFiles]);
  const gitStatsRefreshKey = useMemo(
    () =>
      Object.entries(gitFileStatsByPath)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([path, stats]) =>
            `${path}:${stats.status}:${stats.additions}:${stats.deletions}`,
        )
        .join("|"),
    [gitFileStatsByPath],
  );
  const selectedRelatedFileStatsByKey = useRelatedFileStats(
    relatedSessionRootId || currentRootId,
    selectedSessionRelatedFiles,
    gitStatsRefreshKey,
  );
  const renderRootRelatedContent = (root: string): React.ReactNode => {
    if (!root || root !== currentRootId || root !== relatedSessionRootId) {
      return null;
    }
    if (!relatedSessionSnapshot) {
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
    if (selectedSessionRelatedFiles.length === 0) {
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
        {selectedSessionRelatedFileGroups.map((group) => {
          const isCurrentRepo =
            !group.repoPath ||
            normalizePath(group.repoPath) ===
              normalizePath(managedRootByIdRef.current[root]?.root_path || "");
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
                  selectedRelatedFileStatsByKey[relatedFileStatKey(file)] ||
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
                      onClick={() => handleSelectedSessionFileClick(file)}
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
                        void handleRemoveSessionRelatedFile(
                          relatedSessionRootId,
                          relatedSessionKey,
                          file.path,
                          file.head,
                          file.repo_path,
                          file.repo_kind,
                        );
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
  };
  const renderRootGitContent = (root: string): React.ReactNode => {
    const rootGitStatus =
      root === currentRootId ? gitStatus : gitStatusByRoot[root] || null;
    const rootGitHistory =
      root === currentRootId ? gitHistory : gitHistoryByRoot[root] || null;
    const rootGitStatusLoading =
      root === currentRootId
        ? gitStatusLoading
        : gitStatusLoadingByRoot[root] === true;
    const rootGitHistoryLoading =
      root === currentRootId
        ? gitHistoryLoading
        : gitHistoryLoadingByRoot[root] === true;
    const rootGitStatusAvailable = rootGitStatus?.available === true;
    const rootGitHistoryAvailable = rootGitHistory?.available === true;
    const rootGitStatusExpanded = gitStatusExpandedByRoot[root] !== false;
    const rootGitHistoryExpandedCommits = gitHistoryExpandedByRoot[root] || {};
    const rootShouldRenderGitPanel =
      rootGitStatusLoading || rootGitStatusAvailable;
    const rootShouldRenderGitHistoryPanel =
      rootGitHistoryLoading ||
      (rootGitHistoryAvailable && (rootGitHistory?.items.length || 0) > 0);
    if (managedRootByIdRef.current[root]?.is_git_repo !== true) {
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
    if (
      !rootGitStatus &&
      !rootGitHistory &&
      !rootGitStatusLoading &&
      !rootGitHistoryLoading
    ) {
      return (
        <button
          type="button"
          onClick={() => {
            void refreshGitStatus(root);
            void refreshGitHistory(root);
          }}
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
      !rootGitStatusLoading &&
      !rootGitHistoryLoading &&
      !rootShouldRenderGitPanel &&
      !rootShouldRenderGitHistoryPanel
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
        {rootShouldRenderGitPanel ? (
          <GitStatusPanel
            rootId={root}
            status={rootGitStatus}
            loading={rootGitStatusLoading}
            compact
            expanded={rootGitStatusExpanded}
            onExpandedChange={(expanded) => {
              if (!root) {
                return;
              }
              setGitStatusExpandedByRoot((prev) => ({
                ...prev,
                [root]: expanded,
              }));
            }}
            onSelectItem={(item) => {
              if (!root) {
                return;
              }
              void openGitDiff(root, item);
            }}
            onOpenItem={(item) => {
              if (!root || item.is_dir === true) {
                return;
              }
              actionHandlers.open({ path: item.path, root });
            }}
            onDiscardItem={(item) => {
              if (!root) {
                return;
              }
              return handleGitDiscardItem(root, item);
            }}
            onStageItem={(item) => {
              if (!root) {
                return;
              }
              return item.staged === true
                ? handleGitUnstageItem(root, item)
                : handleGitStageItem(root, item);
            }}
            onPull={() => {
              if (!root) {
                return;
              }
              return handleGitPull(root);
            }}
            onPush={() => {
              if (!root) {
                return;
              }
              return handleGitPush(root);
            }}
            onCommit={(message) => {
              if (!root) {
                return;
              }
              return handleGitCommit(root, message);
            }}
            onSwitchBranch={(branch) => {
              if (!root) {
                return;
              }
              return switchGitBranch(root, branch);
            }}
          />
        ) : null}
        {rootShouldRenderGitHistoryPanel ? (
          <GitHistoryPanel
            rootId={root}
            items={rootGitHistory?.items || []}
            loading={rootGitHistoryLoading}
            loadingMore={gitHistoryLoadingMore}
            hasMore={rootGitHistory?.has_more === true}
            compact
            expandedCommits={rootGitHistoryExpandedCommits}
            onToggleCommit={(hash) => {
              if (!root) {
                return;
              }
              setGitHistoryExpandedByRoot((prev) => {
                const current = prev[root] || {};
                return {
                  ...prev,
                  [root]: {
                    ...current,
                    [hash]: current[hash] !== true,
                  },
                };
              });
            }}
            onLoadMore={() => {
              void loadMoreGitHistory(root);
            }}
            onSelectFile={(commit, item) => {
              if (!root) {
                return;
              }
              void openGitCommitDiff(root, commit, item);
            }}
          />
        ) : null}
      </div>
    );
  };

  if (activePendingPluginTrust) {
    workspaceView = (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--mindfs-main-bg, transparent)",
        }}
      >
        <section
          style={{
            width: "min(720px, 100%)",
            border: "1px solid var(--border-color)",
            borderRadius: 8,
            background: "var(--mindfs-panel-bg, var(--bg-primary))",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ModeIcon type="plugin" size={18} />
            <strong style={{ fontSize: 15, color: "var(--text-primary)" }}>
              {t("plugin.trustTitle")}
            </strong>
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.55,
            }}
          >
            {t("plugin.trustRisk")}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            <div>
              {t("plugin.trustRoot", {
                path: activePendingPluginTrust.bundle.rootPath,
              })}
            </div>
            <div>
              {t("plugin.trustCount", {
                count: activePendingPluginTrust.bundle.plugins.length,
              })}
            </div>
          </div>
          <div
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {activePendingPluginTrust.bundle.plugins.map((plugin) => (
              <div
                key={plugin.path}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 12,
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border-color)",
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {plugin.path}
                </span>
                <span
                  style={{
                    color: "var(--text-secondary)",
                    fontFamily: "monospace",
                  }}
                >
                  {plugin.sha256.slice(0, 12)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              onClick={handleDisablePendingPlugins}
              style={{
                border: "1px solid var(--border-color)",
                background: "transparent",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
                color: "var(--text-secondary)",
              }}
            >
              {t("plugin.trustDisable")}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleTrustPendingPlugins();
              }}
              style={{
                border: "1px solid var(--accent-color)",
                background: "var(--accent-color)",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
                color: "var(--accent-foreground, #fff)",
              }}
            >
              {pluginLoading ? t("plugin.loading") : t("plugin.trustAllow")}
            </button>
          </div>
        </section>
      </div>
    );
  } else if (gitDiff) {
    workspaceView = (
      <GitDiffViewer
        diff={gitDiff}
        root={currentRootId}
        sideBySide={gitDiffSideBySide}
        onPathClick={handleGitDiffPathClick}
        onSessionClick={(sessionKey) =>
          handleSessionChipClick(sessionKey, currentRootIdRef.current)
        }
        onSelectionChange={handleViewerSelectionChange}
      />
    );
  } else if (file) {
    if (pluginRender && pluginRender.output) {
      workspaceView = (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              height: "36px",
              borderBottom: "1px solid var(--border-color)",
              padding: "0 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--mindfs-topbar-bg, transparent)",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ModeIcon type="plugin" size={16} />
              <span>{pluginRender.plugin.name}</span>
              {pluginLoading ? (
                <span style={{ opacity: 0.7 }}>{t("plugin.loading")}</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                void switchToRawFileView();
              }}
              style={{
                border: "1px solid var(--border-color)",
                background: "transparent",
                borderRadius: 6,
                padding: "3px 8px",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              {t("plugin.rawFile")}
            </button>
          </div>
          <div
            ref={pluginContentRef}
            className="plugin-shadcn-sandbox"
            style={{
              ...pluginThemeVars,
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: 12,
            }}
          >
            <Renderer
              key={pluginRendererKey}
              tree={pluginRender.output.tree as any}
              initialState={
                (pluginRender.output.data || {}) as Record<string, unknown>
              }
              handlers={pluginHandlers}
            />
          </div>
        </div>
      );
    } else {
      workspaceView = (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {pluginBypass && matchedPlugin ? (
            <div
              style={{
                borderBottom: "1px solid var(--border-color)",
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--text-secondary)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {t("plugin.rawViewActive", { name: matchedPlugin.name })}
              </span>
              <button
                type="button"
                onClick={() => {
                  void switchToPluginView();
                }}
                style={{
                  border: "1px solid var(--border-color)",
                  background: "transparent",
                  borderRadius: 6,
                  padding: "3px 8px",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                {t("plugin.usePlugin")}
              </button>
            </div>
          ) : null}
          {pluginRender && pluginRender.error ? (
            <div
              style={{
                borderBottom: "1px solid var(--border-color)",
                padding: "8px 12px",
                fontSize: 12,
                color: "#d97706",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {t("plugin.renderFailedFallback", {
                  name: pluginRender.plugin.name,
                })}
              </span>
              <button
                type="button"
                onClick={() => setPluginBypass(true)}
                style={{
                  border: "1px solid var(--border-color)",
                  background: "transparent",
                  borderRadius: 6,
                  padding: "3px 8px",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                {t("plugin.ignorePlugin")}
              </button>
            </div>
          ) : null}
          <WorkspaceFileViewer
            file={file}
            store={fileEditStore}
            onUpdated={(next) => {
              if (
                fileRef.current?.root === next.root &&
                fileRef.current?.path === next.path
              )
                setFile(next);
            }}
            onSaved={(next) => {
              if (
                fileRef.current?.root === next.root &&
                fileRef.current?.path === next.path
              )
                setFile(next);
              if (next.root) void refreshGitStatus(next.root);
            }}
            isVisible={!selectedSession}
            onSelectionChange={handleViewerSelectionChange}
            initialScrollTop={
              fileScrollPositionsRef.current[currentFileScrollKey] || 0
            }
            onScrollTopChange={(scrollTop) => {
              if (!currentFileScrollKey) return;
              fileScrollPositionsRef.current[currentFileScrollKey] = scrollTop;
              persistFileScrollPositions(fileScrollPositionsRef.current);
            }}
            onSessionClick={(sessionKey) =>
              handleSessionChipClick(
                sessionKey,
                file?.root || currentRootIdRef.current,
              )
            }
            onPathClick={handleFileViewerPathClick}
            onFileClick={handleFileViewerFileClick}
          />
        </div>
      );
    }
  } else {
    workspaceView = (
      <DefaultListView
        root={currentRootId || undefined}
        path={selectedDir || ""}
        entries={visibleMainEntries}
        errorMessage={mainDirectoryError}
        showHiddenFiles={showHiddenFiles}
        sortMode={currentDirectorySortMode}
        sortControlValue={currentDirectorySortOverride || "inherit"}
        uploadProgress={directoryUploadProgress}
        onCancelUpload={() => directoryUploadAbortRef.current?.abort()}
        onSortModeChange={(nextMode) => {
          const rootID = currentRootIdRef.current;
          const nextKey = getDirectorySortKey(rootID, selectedDirRef.current);
          if (!nextKey) {
            return;
          }
          setDirectorySortOverrides((prev) => {
            if (nextMode === "inherit") {
              if (!(nextKey in prev)) {
                return prev;
              }
              const next = { ...prev };
              delete next[nextKey];
              return next;
            }
            return { ...prev, [nextKey]: nextMode };
          });
        }}
        onUploadFiles={handleTreeUpload}
        isGitRepo={
          managedRootByIdRef.current[currentRootId || ""]?.is_git_repo === true
        }
        isGitWorktree={
          managedRootByIdRef.current[currentRootId || ""]?.is_git_worktree ===
          true
        }
        enableGitHistoryToggle={false}
        onOpenScheduledAgentTasks={() => setScheduledAgentDialogOpen(true)}
        onItemClick={(e) =>
          e.is_dir
            ? actionHandlers.open_dir({ path: e.path })
            : actionHandlers.open({ path: e.path })
        }
        onPathClick={handleDirectoryPathClick}
      />
    );
  }

  useEffect(() => {
    const body = document.body;
    if (!pluginThemeVars || pluginBypass || !pluginRender?.output) {
      body.removeAttribute("data-plugin-theme");
      body.style.removeProperty("--vp-overlay-bg");
      body.style.removeProperty("--vp-surface-bg");
      body.style.removeProperty("--vp-surface-bg-elevated");
      body.style.removeProperty("--vp-text");
      body.style.removeProperty("--vp-text-muted");
      body.style.removeProperty("--vp-border");
      body.style.removeProperty("--vp-primary");
      body.style.removeProperty("--vp-primary-text");
      body.style.removeProperty("--vp-radius");
      body.style.removeProperty("--vp-shadow");
      body.style.removeProperty("--vp-focus-ring");
      body.style.removeProperty("--vp-danger");
      body.style.removeProperty("--vp-warning");
      body.style.removeProperty("--vp-success");
      return;
    }
    body.setAttribute("data-plugin-theme", "1");
    Object.entries(pluginThemeVars).forEach(([key, value]) => {
      body.style.setProperty(key, String(value));
    });
    return () => {
      body.removeAttribute("data-plugin-theme");
      body.style.removeProperty("--vp-overlay-bg");
      body.style.removeProperty("--vp-surface-bg");
      body.style.removeProperty("--vp-surface-bg-elevated");
      body.style.removeProperty("--vp-text");
      body.style.removeProperty("--vp-text-muted");
      body.style.removeProperty("--vp-border");
      body.style.removeProperty("--vp-primary");
      body.style.removeProperty("--vp-primary-text");
      body.style.removeProperty("--vp-radius");
      body.style.removeProperty("--vp-shadow");
      body.style.removeProperty("--vp-focus-ring");
      body.style.removeProperty("--vp-danger");
      body.style.removeProperty("--vp-warning");
      body.style.removeProperty("--vp-success");
    };
  }, [pluginThemeVars, pluginBypass, pluginRender]);

  const switchToRawFileView = useCallback(async () => {
    if (!file) return;
    const root = file.root || currentRootIdRef.current;
    if (!root) return;
    pluginBypassRef.current = true;
    setPluginBypass(true);
    await actionHandlers.open({
      path: file.path,
      root,
      cursor: fileCursorRef.current || 0,
      readMode: "incremental",
      preservePluginQuery: true,
    });
  }, [file, actionHandlers]);

  const switchToPluginView = useCallback(async () => {
    if (!file) return;
    const root = file.root || currentRootIdRef.current;
    if (!root) return;
    pluginBypassRef.current = false;
    setPluginBypass(false);
    await actionHandlers.open({
      path: file.path,
      root,
      cursor: fileCursorRef.current || 0,
      preservePluginQuery: true,
    });
  }, [file, actionHandlers]);

  const handleRelayAction = useCallback(async () => {
    if (!currentRootId) {
      return;
    }
    const pendingPopup = openPendingPopup();
    const latestStatus = await startRelayBinding();
    const nextStatus = latestStatus || relayStatus;
    if (!nextStatus) {
      pendingPopup?.close();
      return;
    }
    const nodeURL = String(nextStatus?.node_url || "");
    if (nextStatus?.relay_bound && nodeURL) {
      const target = new URL(nodeURL, window.location.origin);
      target.searchParams.set("root", currentRootId);
      navigatePopup(pendingPopup, target.toString());
      return;
    }
    const pendingCode = String(nextStatus?.pending_code || "");
    const nodeName = String(nextStatus?.node_name || "");
    const relayBaseURL = String(nextStatus?.relay_base_url || "");
    if (!pendingCode || !relayBaseURL) {
      pendingPopup?.close();
      return;
    }
    const target = new URL("/bind", relayBaseURL);
    target.searchParams.set("code", pendingCode);
    target.searchParams.set("root", currentRootId);
    if (nodeName) {
      target.searchParams.set("node_name", nodeName);
    }
    navigatePopup(pendingPopup, target.toString());
  }, [currentRootId, startRelayBinding, relayStatus]);

  const relayActionLabel = useMemo(() => {
    if (isRelayNodePage()) {
      return null;
    }
    if (relayStatus?.no_relayer) {
      return null;
    }
    return t("relay.publicAccess");
  }, [relayStatus, t]);

  const relayActionDisabled =
    !currentRootId ||
    (!relayStatus?.relay_bound && !relayStatus?.relay_base_url);
  const showUpdateButton =
    !isIDEManagedProject && shouldShowUpdateButton(updateState);
  const updateBusy =
    updateSubmitting ||
    ["downloading", "installing", "restarting"].includes(
      (updateState.status || "").toLowerCase(),
    );
  const updateLabel = updateButtonLabel(updateState, t);
  const updateHelp = updateState.message || updateSummaryText(updateState, t);
  const updateSummary = updateSummaryText(updateState, t);
  const sessionImportMenu = (
    <div ref={importMenuRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setImportMenuOpen((open) => !open)}
        aria-label={t("externalImport.open")}
        style={{
          border: "none",
          background: "transparent",
          color:
            sessionListMode === "import" && externalImportAgent
              ? "var(--text-secondary)"
              : "#0f766e",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: "34px",
          minWidth: "34px",
          borderRadius: "8px",
          cursor: "pointer",
          padding:
            sessionListMode === "import" && externalImportAgent ? 0 : "0 2px",
        }}
      >
        {sessionListMode === "import" && externalImportAgent ? (
          <>
            <AgentIcon
              agentName={externalImportAgent}
              style={{ width: "14px", height: "14px", display: "block" }}
            />
            <ChevronDownSmallIcon />
          </>
        ) : (
          <ImportIcon />
        )}
      </button>
      {importMenuOpen ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: "260px",
            padding: "10px",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            background: "var(--menu-bg)",
            boxShadow: "0 12px 30px rgba(15, 23, 42, 0.14)",
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            {t("externalImport.chooseAgent")}
          </div>
          <AgentMenuList
            agents={availableAgents}
            selectedAgent={externalImportAgent}
            maxHeight="180px"
            onSelect={(agentName) => {
              setImportMenuOpen(false);
              setExternalImportAgent(agentName);
              setExternalSelectedKey("");
              void enterImportMode(agentName);
            }}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={externalFilterBound}
              onChange={(e) => setExternalFilterBound(e.target.checked)}
            />
            <span>{t("externalImport.hideImported")}</span>
          </label>
        </div>
      ) : null}
    </div>
  );
  const sessionSidebar =
    sessionListMode === "import" ? (
      <ExternalSessionList
        sessions={externalSessions}
        selectedKey={externalSelectedKey}
        selectedAgent={externalImportAgent}
        importingKeys={importingExternalSessionKeys}
        selectedImportKeys={selectedExternalImportKeys}
        filterBound={externalFilterBound}
        headerAction={sessionImportMenu}
        loading={loadingExternalSessions}
        error={externalSessionsError}
        loadingOlder={loadingOlderExternalSessions}
        confirmingImport={confirmingExternalImport}
        hasMore={hasMoreExternalSessions}
        onBack={exitImportMode}
        onSelect={(session) =>
          setExternalSelectedKey(
            String(session.key || session.session_key || ""),
          )
        }
        onToggleImport={toggleExternalImportSelection}
        onToggleSelectAllImport={toggleAllExternalImportSelection}
        onConfirmImport={() => {
          void handleConfirmExternalImport();
        }}
        onLoadOlder={() => {
          void handleLoadOlderExternalSessions();
        }}
      />
    ) : !isIDEManagedProject &&
      multiProjectSessionsEnabled &&
      !sessionSearchOpen &&
      !sessionSearchResultsMode ? (
      <MultiProjectSessionList
        groups={multiProjectSessionGroups}
        selectedKey={selectedSession?.key}
        selectedRootId={
          (selectedSession?.root_id as string | undefined) ||
          currentRootId ||
          ""
        }
        headerAction={sessionImportMenu}
        loading={multiProjectSessionsLoading}
        emptyText={t("externalImport.empty")}
        syncingSessionKeys={syncingSessionKeys}
        onSearchToggle={() => {
          setSessionSearchOpen(true);
          setSessionSearchResultsMode(false);
          setSessionSearchQuery("");
          setSessionSearchAppliedQuery("");
          setSessionSearchResults([]);
          setSessionSearchLoading(false);
        }}
        onSelect={(s) => {
          handleSelectSession(s);
          if (isMobile || isIdeaRuntime) setIsRightOpen(false);
        }}
        onSync={handleSyncSession}
        onPin={handlePinSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
        onProjectClick={(rootId) => {
          actionHandlers.open_dir({
            path: rootId,
            root: rootId,
            isRoot: true,
            suppressTreeExpand: true,
          });
          if (isMobile) setIsRightOpen(false);
        }}
        onLoadMoreProject={loadMoreMultiProjectSessions}
        onLoadChildren={loadChildSessionsForParent}
      />
    ) : (
      <SessionList
        sessions={
          sessionSearchOpen && sessionSearchResultsMode
            ? sessionSearchResults
            : sessions
        }
        selectedKey={selectedSession?.key}
        headerAction={sessionImportMenu}
        persistentSearch={isIdeaRuntime}
        searchOpen={sessionSearchOpen}
        searchResultsMode={sessionSearchResultsMode}
        searchQuery={sessionSearchQuery}
        searchLoading={sessionSearchLoading}
        syncingSessionKeys={syncingSessionKeys}
        emptyText={
          sessionSearchResultsMode ? (
            sessionSearchLoading ? (
              t("sessionList.searching")
            ) : (
              t("externalImport.noSearchMatch")
            )
          ) : (
            <span>
              {t("externalImport.emptyHintPrefix")}
              <strong style={{ color: "var(--text-primary)", fontWeight: 800 }}>
                {t("externalImport.emptyHintAction")}
              </strong>
            </span>
          )
        }
        onSearchToggle={() => {
          setSessionSearchOpen((prev) => {
            const next = !prev;
            if (!next) {
              setSessionSearchResultsMode(false);
              setSessionSearchQuery("");
              setSessionSearchAppliedQuery("");
              setSessionSearchResults([]);
              setSessionSearchLoading(false);
            }
            return next;
          });
        }}
        onSearchQueryChange={(value) => {
          setSessionSearchQuery(value);
          setSessionSearchAppliedQuery("");
          if (!value.trim()) {
            setSessionSearchOpen(isIdeaRuntime);
            setSessionSearchResultsMode(false);
            setSessionSearchAppliedQuery("");
            setSessionSearchResults([]);
            setSessionSearchLoading(false);
            return;
          }
          setSessionSearchOpen(true);
          setSessionSearchResultsMode(true);
          setSessionSearchResults([]);
          setSessionSearchLoading(true);
        }}
        onSearchBlur={() => {
          setSessionSearchOpen(false);
          setSessionSearchResultsMode(false);
          setSessionSearchQuery("");
          setSessionSearchAppliedQuery("");
          setSessionSearchResults([]);
          setSessionSearchLoading(false);
        }}
        onSearchBack={() => {
          setSessionSearchResultsMode(false);
          setSessionSearchQuery("");
          setSessionSearchAppliedQuery("");
          setSessionSearchResults([]);
          setSessionSearchLoading(false);
          setSessionSearchOpen(false);
        }}
        onSelect={(s) => {
          handleSelectSession(s);
          if (isMobile || isIdeaRuntime) setIsRightOpen(false);
        }}
        onSync={handleSyncSession}
        onPin={handlePinSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
        onLoadChildren={
          sessionSearchOpen && sessionSearchResultsMode
            ? undefined
            : loadChildSessionsForParent
        }
        onLoadOlder={
          sessionSearchOpen && sessionSearchResultsMode
            ? undefined
            : handleLoadOlderSessions
        }
        loadingOlder={
          sessionSearchOpen && sessionSearchResultsMode
            ? false
            : loadingOlderSessions
        }
        hasMore={
          sessionSearchOpen && sessionSearchResultsMode
            ? false
            : hasMoreSessions
        }
      />
    );
  const currentOpenSessionTabs: SessionTabItem[] = currentRootId
    ? (openSessionTabsByRoot[currentRootId] || []).map((tab) => {
        const key = tab.key || tab.session_key;
        const selectedKey =
          selectedSession?.key || selectedSession?.session_key;
        const selectedRoot =
          (selectedSession?.root_id as string | undefined) || currentRootId;
        const selected =
          selectedKey === key && selectedRoot === currentRootId
            ? selectedSession
            : null;
        const latest = selected || sessionByKey[key] || tab;
        return {
          key,
          label:
            String(latest?.name || latest?.title || "").trim() ||
            (key.startsWith("pending-")
              ? t("session.new")
              : `Session ${key.slice(0, 8)}`),
          pending: resolvePendingForSession(
            currentRootId,
            key,
            !!latest?.pending,
          ),
        };
      })
    : [];
  const activeSessionTabKey =
    selectedSession &&
    ((selectedSession.root_id as string | undefined) || currentRootId) ===
      currentRootId
      ? selectedSession.key || selectedSession.session_key
      : "";

  return (
    <>
      <AppShell
        ideaWorkbench={
          isIdeaRuntime
            ? {
                projectName: basenameOfPath(
                  managedRootByIdRef.current[currentRootId || ""]?.root_path ||
                    currentRootId ||
                    "",
                ),
                onNewSession: handleNewSession,
                composerAction: ideaUserMessageSummaries.length ? (
                  <UserMessageSummaryButton
                    key={activeSessionTabKey}
                    summaries={ideaUserMessageSummaries}
                  />
                ) : null,
              }
            : undefined
        }
        leftOpen={isLeftOpen}
        rightOpen={isRightOpen}
        sidebarsSwapped={sidebarsSwapped}
        onCloseLeft={() => setIsLeftOpen(false)}
        onCloseRight={() => setIsRightOpen(false)}
        onOpenLeft={() => setIsLeftOpen(true)}
        onOpenRight={() => setIsRightOpen(true)}
        sidebar={
          <FileTree
            agentSettingsOnly={isIdeaRuntime}
            agentSettingsActive={isLeftOpen}
            agentsVersion={agentsVersion}
            entries={rootEntries}
            childrenByPath={entriesByPath}
            expanded={expanded}
            sortMode={treeSortMode}
            showHiddenFiles={showHiddenFiles}
            onSortModeChange={setTreeSortMode}
            onShowHiddenFilesChange={setShowHiddenFiles}
            onRefresh={handleProjectTreeRefresh}
            selectedDirKey={selectedDirKey}
            selectedPath={file?.path}
            rootId={currentRootId}
            rootSessionIndicators={rootSessionIndicators}
            onSelectFile={(e, r) => {
              actionHandlers.open({ path: e.path, root: r });
              if (isMobile) setIsLeftOpen(false);
            }}
            onSelectRoot={(e, r) =>
              actionHandlers.open_dir({
                path: e.path,
                root: r,
                isRoot: e.is_root === true,
                suppressTreeExpand: true,
              })
            }
            onToggleDir={(e, r) =>
              actionHandlers.open_dir({
                path: e.path,
                root: r,
                toggle: true,
                isRoot: e.is_root === true,
              })
            }
            renderRootExtraContent={renderRootGitContent}
            renderRootWorktreeContent={renderRootWorktreeContent}
            renderRootRelatedContent={renderRootRelatedContent}
            projectTreeTabRequest={projectTreeTabRequest}
            onProjectTreeTabChange={setProjectTreeTab}
            relayActionLabel={relayActionLabel}
            relayActionDisabled={relayActionDisabled}
            relayActionHelp={null}
            onRelayAction={handleRelayAction}
            relayNodeId={relayStatus?.node_id || ""}
            relayBaseURL={relayStatus?.relay_base_url || ""}
            relayNoRelayer={
              isIDEManagedProject || relayStatus?.no_relayer === true
            }
            updateActionLabel={showUpdateButton ? updateLabel : null}
            updateActionDisabled={updateBusy}
            updateActionHelp={showUpdateButton ? updateHelp : ""}
            updateActionBusy={updateBusy}
            updateActionSummary={showUpdateButton ? updateSummary : ""}
            onUpdateAction={() => {
              void handleStartUpdate();
            }}
            sidebarsSwapped={sidebarsSwapped}
            onSidebarsSwappedChange={setSidebarsSwapped}
            gitDiffSideBySide={gitDiffSideBySide}
            onGitDiffSideBySideChange={setGitDiffSideBySide}
            multiProjectSessionsEnabled={multiProjectSessionsEnabled}
            onMultiProjectSessionsChange={setMultiProjectSessionsEnabled}
            onRunAgentLifecycleCommand={async (...args) => {
              await handleRunAgentLifecycleCommand(...args);
              if (isIdeaRuntime) {
                setIsLeftOpen(false);
                setIsRightOpen(false);
              }
            }}
            onRestartAgent={handleRestartAgent}
            onGoHome={onGoHome}
          />
        }
        rightSidebar={sessionSidebar}
        main={
          <div
            data-onboarding="workspace"
            style={{
              width: "100%",
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}
          >
            {isIdeaRuntime && currentRootId ? (
              <SessionTabs
                tabs={currentOpenSessionTabs}
                activeKey={activeSessionTabKey}
                ariaLabel={t("sessionTabs.label")}
                previousLabel={t("sessionTabs.previous")}
                nextLabel={t("sessionTabs.next")}
                closeLabel={(name) => t("sessionTabs.close", { name })}
                runningLabel={t("sessionList.replying")}
                onSelect={(key) => handleSelectSessionTab(currentRootId, key)}
                onClose={(key) => handleCloseSessionTab(currentRootId, key)}
              />
            ) : null}

            <div
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                id="idea-active-session-panel"
                role="tabpanel"
                style={{
                  display: selectedSession ? "flex" : "none",
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                }}
              >
                {sessionView}
              </div>
              <div
                style={{
                  display: selectedSession ? "none" : "flex",
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  flexDirection: "column",
                }}
              >
                {isIdeaRuntime ? (
                  <div className="idea-empty-chat">
                    <h2>{t("idea.startChat")}</h2>
                    <p>{t("idea.startHint")}</p>
                  </div>
                ) : (
                  workspaceView
                )}
              </div>
            </div>
          </div>
        }
        footer={
          <div
            style={{
              width: "100%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              background: "var(--content-bg)",
            }}
          >
            {currentRootSlashCommandResult ? (
              <div
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: isMobile ? "0 0 6px" : "0 16px 8px",
                }}
              >
                {renderRootSlashCommandResult(currentRootSlashCommandResult)}
              </div>
            ) : null}
            <ActionBar
              compactWorkbench={isIdeaRuntime}
              status={status}
              agentsVersion={agentsVersion}
              currentRootId={currentRootId}
              currentSession={actionBarSession}
              pendingPlanMode={pendingPlanMode}
              attachedFileContext={attachedFileContext}
              canOpenSessionDrawer={canOpenSessionDrawer}
              sessionDrawerOpen={isDrawerOpen}
              detachedBoundSession={detachedBoundSession}
              editDraftRequest={editDraftRequest}
              queuedMessages={actionBarQueuedMessages}
              inputHistory={actionBarInputHistory}
              onSendMessage={handleSendMessage}
              onSetPlanMode={handleSetPlanMode}
              onCancelCurrentTurn={handleCancelCurrentTurn}
              onRemoveQueuedMessage={handleRemoveQueuedMessage}
              onUpdateQueuedMessage={handleUpdateQueuedMessage}
              onSendQueuedMessageNow={handleSendQueuedMessageNow}
              onNewSession={handleNewSession}
              onRequestFileContext={handleRequestFileContext}
              onClearFileContext={handleClearFileContext}
              onToggleLeftSidebar={() => setIsLeftOpen((v) => !v)}
              onToggleRightSidebar={() => setIsRightOpen((v) => !v)}
              sidebarsSwapped={sidebarsSwapped}
              onSessionClick={() => {
                const rootID = currentRootIdRef.current;
                if (!activeBoundSessionKey) return;
                const selectedKey =
                  selectedSession?.key || selectedSession?.session_key;
                const isBoundSessionInMain =
                  selectedKey === activeBoundSessionKey &&
                  interactionMode !== "drawer";
                if (isBoundSessionInMain) return;
                const isDrawerCurrentlyOpen =
                  !!drawerOpenByRootRef.current[rootID || ""];
                if (isDrawerCurrentlyOpen) {
                  interactionModeRef.current = "main";
                  setInteractionMode("main");
                  setDrawerOpenForRoot(rootID, false);
                  return;
                }
                setInteractionMode("drawer");
                setDrawerOpenForRoot(rootID, true);
              }}
            />
          </div>
        }
        drawer={
          <BottomSheet
            inline={isIdeaRuntime}
            isOpen={isDrawerOpen}
            onClose={() => {
              interactionModeRef.current = "main";
              setInteractionMode("main");
              setDrawerOpenForRoot(currentRootIdRef.current, false);
            }}
            onExpand={() => {
              handleSelectSession(currentSession);
              setDrawerOpenForRoot(currentRootIdRef.current, false);
            }}
          >
            {drawerSessionSnapshot ? (
              <SessionViewer
                connected={status === "connected"}
                session={drawerSessionSnapshot}
                agents={availableAgents}
                slashCommandResult={slashCommandResultForSession(
                  currentRootId,
                  drawerSessionSnapshot,
                )}
                targetSeq={currentSession?.search_seq}
                targetSeqRequestKey={currentSession?.search_target_id}
                loading={
                  drawerLoadingSessionByRoot[currentRootId || ""] ===
                  (drawerSessionSnapshot.key ||
                    drawerSessionSnapshot.session_key)
                }
                rootId={currentRootId}
                rootPath={
                  managedRootByIdRef.current[currentRootId || ""]?.root_path ||
                  null
                }
                interactionMode="drawer"
                gitFileStatsByPath={gitFileStatsByPath}
                onFileClick={handleDrawerSessionFileClick}
                onRootClick={(root) => {
                  void actionHandlers.open_dir({
                    path: root,
                    root,
                    isRoot: true,
                    forceDirectory: true,
                    suppressTreeExpand: true,
                  });
                }}
                onRemoveRelatedFile={(path, head, repoPath, repoKind) =>
                  void handleRemoveSessionRelatedFile(
                    currentRootId,
                    drawerSessionSnapshot?.key ||
                      drawerSessionSnapshot?.session_key,
                    path,
                    head,
                    repoPath,
                    repoKind,
                  )
                }
                onAskUserAnswer={handleAskUserAnswer}
                onEditUserMessage={handleEditUserMessage}
                onForkAgentMessage={(seq) =>
                  void handleForkAgentMessage(
                    currentRootId,
                    drawerSessionSnapshot?.key ||
                      drawerSessionSnapshot?.session_key,
                    seq,
                  )
                }
                onOpenSubagent={(subagent) =>
                  void handleOpenSubagent(
                    currentRootId || "",
                    drawerSessionSnapshot?.key || drawerSessionSnapshot?.session_key || "",
                    subagent,
                  )
                }
                onStopSubagent={(subagent) =>
                  void handleStopSubagent(
                    currentRootId || "",
                    drawerSessionSnapshot?.key || drawerSessionSnapshot?.session_key || "",
                    subagent,
                  )
                }
              />
            ) : (
              <div style={{ padding: "40px", textAlign: "center" }}>
                {t("session.startHint")}
              </div>
            )}
          </BottomSheet>
        }
      />

      {bootstrapState.phase === "error" ? (
        <ConnectionErrorDialog
          error={bootstrapState.error}
          onRetry={() => {
            didInitRef.current = false;
            void bootstrapService.start();
          }}
        />
      ) : null}
      {bootstrapState.phase === "needs_pairing" &&
      e2eeState.required &&
      !e2eeState.unlocked ? (
        <div className="remote-access-overlay">
          <div
            className="remote-host-card"
            role="dialog"
            aria-modal="true"
            aria-label={
              locale === "zh-CN" ? "连接远程访问" : "Connect remote access"
            }
          >
            <RemoteAccessRequired />
          </div>
        </div>
      ) : null}

      <ScheduledAgentTaskDialog
        open={scheduledAgentDialogOpen}
        rootId={currentRootId}
        agents={availableAgents}
        onClose={() => setScheduledAgentDialogOpen(false)}
      />

      <ToastContainer />
    </>
  );
}
