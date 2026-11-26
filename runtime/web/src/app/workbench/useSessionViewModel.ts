import { useCallback, useMemo } from "react";
import { isIdeaRuntime, openIdeaFile } from "../../services/ideaBridge";
import { buildBaseTimeline } from "../../hooks/useSessionStream";
import { type Session, sessionService } from "../../services/session";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useManagedRoots } from "./useManagedRoots";
import type { useSessionList } from "./useSessionList";
import type { useSessionCacheState } from "./useSessionCacheState";
import type { useActionHandlers } from "./useActionHandlers";
import type { useSessionRestore } from "./useSessionRestore";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  sessionListApi: ReturnType<typeof useSessionList>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  sessionRestoreApi: ReturnType<typeof useSessionRestore>;
};

export function useSessionViewModel({ appFoundationApi, currentRootApi, sessionSelectionApi, managedRootsApi, sessionListApi, sessionCacheStateApi, actionHandlersApi, sessionRestoreApi }: Deps) {
  const { boundSessionByRootRef, drawerSessionByRootRef, selectedSessionRef, t } = appFoundationApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;
  const { activeBoundSessionKey, cacheVersion, currentSession, rootSessionKey, selectedSession, setEditDraftRequest } = sessionSelectionApi;
  const { managedRootIds } = managedRootsApi;
  const { multiProjectPendingByKey } = sessionListApi;
  const { getSessionSnapshot } = sessionCacheStateApi;
  const { actionHandlers } = actionHandlersApi;
  const { selectedSessionSnapshot } = sessionRestoreApi;

  const handleSelectedSessionFileClick = useCallback(
    (target: string | { path: string }) => {
      const root =
        (selectedSessionRef.current?.root_id as string | undefined) ||
        currentRootIdRef.current;
      if (!root) return;
      const path = typeof target === "string" ? target : target?.path;
      if (!path) return;
      if (isIdeaRuntime) {
        openIdeaFile(root, path);
        return;
      }
      void actionHandlers.open({ path, root });
    },
    [actionHandlers],
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
    (target: string | { path: string }) => {
      const root = currentRootIdRef.current;
      if (!root) return;
      const path = typeof target === "string" ? target : target?.path;
      if (!path) return;
      if (isIdeaRuntime) {
        openIdeaFile(root, path);
        return;
      }
      void actionHandlers.open({ path, root });
    },
    [actionHandlers],
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

  return { drawerSessionSnapshot, handleAskUserAnswer, handleDrawerSessionFileClick, handleEditUserMessage, handleSelectedSessionFileClick, ideaUserMessageSummaries, rootSessionIndicators };
}
