import { useState, useEffect, useCallback } from "react";
import { SessionItem, OpenSessionTab, SlashCommandResult, toSessionItem } from "../sessionModel";
import { type Session } from "../../services/session";
import { usePhoneWaiting } from "../../components/remoteui/phoneSessionFacts";
import type { useAppFoundation } from "./useAppFoundation";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
};

export function useSessionSelection({ appFoundationApi, workbenchLayoutApi, currentRootApi }: Deps) {
  const { boundSessionByRootRef, currentSessionRef, drawerOpenByRootRef, drawerSessionByRootRef, interactionModeRef, mainViewPreferenceByRootRef, selectedSessionRef, sessionCacheRef } = appFoundationApi;
  const { remotePhone } = workbenchLayoutApi;
  const { currentRootId, currentRootIdRef } = currentRootApi;

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
  const [queueVersion, setQueueVersion] = useState(0);
  const [interactionMode, setInteractionMode] = useState<"main" | "drawer">(
    "main",
  );
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editDraftRequest, setEditDraftRequest] = useState<{
    id: number;
    content: string;
    mode?: "replace" | "append";
  } | null>(null);
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
    setPendingPlanMode(false);
  }, [currentRootId]);
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);
  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);
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
  const phoneWaiting = usePhoneWaiting(remotePhone, resolveRootForSessionKey);

  return { activeBoundSessionKey, bumpCacheVersion, cacheVersion, clearSlashCommandResultForSession, currentSession, drawerLoadingSessionByRoot, editDraftRequest, interactionMode, isDrawerOpen, openSessionTab, openSessionTabsByRoot, pendingPlanMode, phoneWaiting, queueVersion, removeSessionTabs, resolveRootForSessionKey, rootSessionKey, selectedSession, selectedSessionLoading, setActiveBoundSessionKey, setBoundSessionForRoot, setCurrentSession, setDrawerOpenForRoot, setDrawerSessionForRoot, setEditDraftRequest, setInteractionMode, setIsDrawerOpen, setMainViewPreferenceForRoot, setOpenSessionTabsByRoot, setPendingPlanMode, setQueueVersion, setSelectedSession, setSelectedSessionLoading, setSlashCommandResults, slashCommandResults };
}
