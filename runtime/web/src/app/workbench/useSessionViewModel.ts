import { useCallback, useMemo } from "react";
import { RelatedFileClickTarget } from "../fileNavigation";
import { isIdeaRuntime, openIdeaFile } from "../../services/ideaBridge";
import { buildBaseTimeline } from "../../hooks/useSessionStream";
import { type Session, sessionService, setCachedSessionRelatedFiles } from "../../services/session";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { useManagedRoots } from "./useManagedRoots";
import type { useSessionList } from "./useSessionList";
import type { useSessionCacheState } from "./useSessionCacheState";
import type { useActionHandlers } from "./useActionHandlers";
import type { useSessionRestore } from "./useSessionRestore";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  sessionListApi: ReturnType<typeof useSessionList>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  sessionRestoreApi: ReturnType<typeof useSessionRestore>;
};

export function useSessionViewModel({ appFoundationApi, currentRootApi, sessionSelectionApi, projectTreeApi, managedRootsApi, sessionListApi, sessionCacheStateApi, actionHandlersApi, sessionRestoreApi }: Deps) {
  const { boundSessionByRootRef, drawerSessionByRootRef, selectedSessionRef, t } = appFoundationApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { activeBoundSessionKey, cacheVersion, currentSession, rootSessionKey, selectedSession, setEditDraftRequest } = sessionSelectionApi;
  const { setExpanded, setProjectTreeTabRequest } = projectTreeApi;
  const { managedRootIds } = managedRootsApi;
  const { multiProjectPendingByKey } = sessionListApi;
  const { getSessionSnapshot, updateSessionRelatedFilesForKey } = sessionCacheStateApi;
  const { openRelatedFileDiff } = actionHandlersApi;
  const { selectedSessionSnapshot } = sessionRestoreApi;

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
  const handleEditUserMessage = useCallback((content: string) => {
    setEditDraftRequest((prev) => ({
      id: (prev?.id || 0) + 1,
      content,
    }));
  }, []);

  return { drawerSessionSnapshot, handleAskUserAnswer, handleDrawerSessionFileClick, handleEditUserMessage, handleRemoveSessionRelatedFile, handleSelectedSessionFileClick, ideaUserMessageSummaries, rootSessionIndicators };
}
