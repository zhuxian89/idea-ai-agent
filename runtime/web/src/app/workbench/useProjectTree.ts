import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  type FileEntry,
  type DirectorySortMode,
  DEFAULT_DIRECTORY_SORT_MODE,
} from "../../services/directorySort";
import {
  loadBooleanRecord,
  GIT_STATUS_EXPANDED_STORAGE_KEY,
  loadStringBooleanRecord,
  GIT_HISTORY_EXPANDED_STORAGE_KEY,
  TREE_SORT_STORAGE_KEY,
  DIRECTORY_SORT_OVERRIDES_STORAGE_KEY,
} from "../storagePrefs";
import { projectStorage } from "../../services/remoteScope";
import { isDirectorySortMode } from "../urlState";
import { type ProjectTreeTab } from "../../components/FileTree";
import { protectedJSON as apiProtectedJSON } from "../../services/api";
import { appURL } from "../../services/base";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
};

export function useProjectTree({ appFoundationApi, currentRootApi }: Deps) {
  const { expandedRef, invalidTreeCacheKeysRef, selectedDirRef, t } = appFoundationApi;
  const { currentRootId } = currentRootApi;

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
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [projectTreeTab, setProjectTreeTab] = useState<ProjectTreeTab>("files");
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
  const visibleMainEntries = useMemo(
    () =>
      showHiddenFiles
        ? mainEntries
        : mainEntries.filter((entry) => !entry.name.startsWith(".")),
    [mainEntries, showHiddenFiles],
  );

  return { currentDirectorySortMode, currentDirectorySortOverride, entriesByPath, entriesByPathRef, expanded, formatDirectoryLoadError, getDirectorySortKey, gitHistoryExpandedByRoot, gitStatusExpandedByRoot, mainDirectoryError, normalizeTreeResponse, projectTreeTab, refreshTreeDir, selectedDir, selectedDirKey, setDirectorySortOverrides, setEntriesByPath, setExpanded, setGitHistoryExpandedByRoot, setGitStatusExpandedByRoot, setMainDirectoryError, setMainEntries, setProjectTreeTab, setSelectedDir, setSelectedDirKey, setShowHiddenFiles, setTreeSortMode, showHiddenFiles, treeCacheKey, treeSortMode, visibleMainEntries };
}
