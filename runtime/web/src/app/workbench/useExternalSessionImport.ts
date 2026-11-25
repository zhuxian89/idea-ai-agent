import { useState, useRef, useEffect, useCallback } from "react";
import { SessionItem, toSessionItem } from "../sessionModel";
import { sessionService } from "../../services/session";
import { mergeSessionItems, applyPinnedSnapshotToSessions } from "../../services/sessionListMerge";
import { reportError } from "../../services/error";
import type { useAppFoundation } from "./useAppFoundation";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionList } from "./useSessionList";
import type { useWorkbenchSessionNavigation } from "./useWorkbenchSessionNavigation";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionListApi: ReturnType<typeof useSessionList>;
  workbenchSessionNavigationApi: ReturnType<typeof useWorkbenchSessionNavigation>;
};

export function useExternalSessionImport({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionListApi, workbenchSessionNavigationApi }: Deps) {
  const { t } = appFoundationApi;
  const { isMobile, setIsRightOpen } = workbenchLayoutApi;
  const { currentRootIdRef } = currentRootApi;
  const { sessionListMode, setHasMoreSessions, setSessionListMode, setSessions } = sessionListApi;
  const { handleSelectSession } = workbenchSessionNavigationApi;

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
    externalSessionsRef.current = externalSessions;
  }, [externalSessions]);
  useEffect(() => {
    externalImportAgentRef.current = externalImportAgent;
  }, [externalImportAgent]);
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

  return { confirmingExternalImport, enterImportMode, exitImportMode, externalFilterBound, externalImportAgent, externalImportAgentRef, externalSelectedKey, externalSessions, externalSessionsError, handleConfirmExternalImport, handleLoadOlderExternalSessions, hasMoreExternalSessions, importMenuOpen, importMenuRef, importingExternalSessionKeys, loadExternalSessions, loadingExternalSessions, loadingOlderExternalSessions, selectedExternalImportKeys, setConfirmingExternalImport, setExternalFilterBound, setExternalImportAgent, setExternalSelectedKey, setExternalSessions, setImportMenuOpen, setImportingExternalSessionKeys, setSelectedExternalImportKeys, toggleAllExternalImportSelection, toggleExternalImportSelection };
}
