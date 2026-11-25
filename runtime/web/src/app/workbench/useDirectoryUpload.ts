import { useState, useRef, useCallback } from "react";
import { type UploadProgress, uploadFiles, isUploadAbortError } from "../../services/upload";
import { dirnameOfPath } from "../fileNavigation";
import { invalidateFileCache } from "../../services/file";
import { reportError } from "../../services/error";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useProjectTree } from "./useProjectTree";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
};

export function useDirectoryUpload({ appFoundationApi, currentRootApi, projectTreeApi }: Deps) {
  const { fileRef, selectedDirRef, t } = appFoundationApi;
  const { currentRootIdRef } = currentRootApi;
  const { refreshTreeDir, setExpanded } = projectTreeApi;

  const [directoryUploadProgress, setDirectoryUploadProgress] =
    useState<UploadProgress | null>(null);
  const directoryUploadAbortRef = useRef<AbortController | null>(null);
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

  return { directoryUploadAbortRef, directoryUploadProgress, handleTreeUpload };
}
