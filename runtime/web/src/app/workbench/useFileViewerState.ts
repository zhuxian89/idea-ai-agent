import { useState, useEffect, useCallback } from "react";
import { WSStatus } from "../runtimeTypes";
import { type FilePayload, fetchEditableFile, fetchFile, saveTextFile } from "../../services/file";
import { FileEditStore } from "../../services/fileEditing";
import { translateNow } from "../../i18n";
import { ViewerSelection, AttachedFileContext, buildFileScrollKey } from "../fileNavigation";
import { buildMatchInputFromPath, inferReadModeFromPlugin } from "../pluginInput";
import { persistFileScrollPositions } from "../storagePrefs";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { usePluginState } from "./usePluginState";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  pluginStateApi: ReturnType<typeof usePluginState>;
};

export function useFileViewerState({ appFoundationApi, currentRootApi, pluginStateApi }: Deps) {
  const { dismissedSelectionFileRef, fileCursorRef, fileRef, fileScrollPositionsRef, lastViewerSelectionRef, pluginBypassRef, pluginManagerRef, viewerSelectionRef } = appFoundationApi;
  const { currentRootIdRef } = currentRootApi;
  const { pluginQueryRef } = pluginStateApi;

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

  const [status, setStatus] = useState<WSStatus>("disconnected");
  const [file, setFile] = useState<FilePayload | null>(null);
  const [viewerSelection, setViewerSelection] =
    useState<ViewerSelection | null>(null);
  const [attachedFileContext, setAttachedFileContext] =
    useState<AttachedFileContext | null>(null);
  useEffect(() => {
    fileRef.current = file;
  }, [file]);
  useEffect(() => {
    viewerSelectionRef.current = viewerSelection;
  }, [viewerSelection]);
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

  return { attachedFileContext, buildAttachedFileContext, file, fileEditStore, handleViewerSelectionChange, refreshCurrentFileContent, rememberCurrentFileScroll, setAttachedFileContext, setFile, setStatus, setViewerSelection, status, viewerSelection };
}
