import React from "react";
import { invalidateFileCache, type FilePayload } from "../../services/file";
import {
  buildGitDiffCacheSignature,
  fetchGitDiff,
  type GitDiffPayload,
  type GitStatusPayload,
} from "../../services/git";

type Options = {
  selectedDirRef: React.RefObject<string | null>;
  invalidatePluginsForRoot: (rootId: string) => void;
  fileRef: React.RefObject<FilePayload | null>;
  currentRootIdRef: React.RefObject<string | null>;
  refreshCurrentFileContent: (
    rootID: string,
    changedPath: string,
  ) => Promise<void>;
  refreshGitStatus: (rootID: string) => Promise<GitStatusPayload | null>;
  setGitDiff: React.Dispatch<React.SetStateAction<GitDiffPayload | null>>;
  gitDiff: GitDiffPayload | null;
  invalidTreeCacheKeysRef: React.RefObject<Set<string>>;
  treeCacheKey: (rootID: string, dirPath: string) => string;
  refreshTreeDir: (
    rootID: string,
    dirPath: string,
    syncMain: boolean,
  ) => Promise<void>;
};

export function createFileChangeHandlers({
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
}: Options) {
  const dirname = (path: string): string => {
    const clean = (path || "").replace(/^\/+|\/+$/g, "");
    if (!clean || clean === ".") return ".";
    const idx = clean.lastIndexOf("/");
    return idx <= 0 ? "." : clean.slice(0, idx);
  };

  const currentDirAPI = (rootID: string): string => {
    const selected = selectedDirRef.current;
    if (!selected || selected === rootID) return ".";
    return selected;
  };

  const stringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value.filter(
          (item): item is string => typeof item === "string" && item !== "",
        ),
      ),
    );
  };

  const handleFileChangedBatch = (payload: any) => {
    const rootID = typeof payload?.root_id === "string" ? payload.root_id : "";
    if (!rootID) return;

    const paths = stringList(payload?.paths);
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const dirPathSet = new Set(stringList(payload?.dirs));
    for (const path of paths) {
      const parentDir = dirname(path);
      dirPathSet.add(parentDir);
      const event = events.find((item: any) => item?.path === path);
      const op = typeof event?.op === "string" ? event.op : "";
      if (
        event?.is_dir === true ||
        op.includes("REMOVE") ||
        op.includes("RENAME")
      ) {
        dirPathSet.add(path);
      }
    }
    const dirs = Array.from(dirPathSet);
    if (paths.length === 0 && dirs.length === 0) return;

    for (const path of paths) {
      invalidateFileCache(rootID, path);
    }
    if (
      [...paths, ...dirs].some((path) => {
        const normalized = String(path || "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "");
        return (
          normalized === ".mindfs/plugins" ||
          normalized.startsWith(".mindfs/plugins/")
        );
      })
    ) {
      invalidatePluginsForRoot(rootID);
    }

    const currentFile = fileRef.current;
    const currentFileRoot = currentFile?.root || currentRootIdRef.current || "";
    if (
      currentFile &&
      currentFileRoot === rootID &&
      paths.includes(currentFile.path)
    ) {
      void refreshCurrentFileContent(rootID, currentFile.path);
    }

    void refreshGitStatus(rootID).then((next) => {
      if (!next?.available) {
        if (rootID === currentRootIdRef.current) {
          setGitDiff(null);
        }
        return;
      }
      const changedDiffPath = gitDiff?.path || "";
      if (
        rootID === currentRootIdRef.current &&
        changedDiffPath &&
        paths.includes(changedDiffPath)
      ) {
        const target = next.items.find((item) => item.path === changedDiffPath);
        if (!target) {
          setGitDiff(null);
          return;
        }
        void fetchGitDiff(rootID, changedDiffPath, {
          cacheSignature: buildGitDiffCacheSignature(target),
        })
          .then(setGitDiff)
          .catch((err) => {
            console.error("[git.diff.refresh] failed", {
              rootID,
              changedPath: changedDiffPath,
              err,
            });
          });
      }
    });

    const currentDir = currentDirAPI(rootID);
    for (const dir of dirs) {
      invalidTreeCacheKeysRef.current.add(treeCacheKey(rootID, dir));
      if (rootID === currentRootIdRef.current && dir === currentDir) {
        void refreshTreeDir(rootID, dir, true);
      }
    }
  };

  const handleFileChanged = (payload: any) => {
    const rootID = typeof payload?.root_id === "string" ? payload.root_id : "";
    const changedPath = typeof payload?.path === "string" ? payload.path : "";
    if (!rootID || !changedPath) return;
    const dirs = [dirname(changedPath)];
    if (payload?.is_dir === true) {
      dirs.push(changedPath);
    }
    handleFileChangedBatch({
      root_id: rootID,
      paths: [changedPath],
      dirs,
      events: [{ path: changedPath, op: payload?.op, is_dir: payload?.is_dir }],
    });
  };
  return { handleFileChangedBatch, handleFileChanged };
}
