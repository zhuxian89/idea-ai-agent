import React from "react";
import {
  sessionService,
  setCachedSessionRelatedFiles,
  type RelatedFile,
  type Session,
  type SyncSessionResult,
} from "../../services/session";
import {
  hasSessionExchanges,
  SessionItem,
  toSessionItem,
} from "../sessionModel";

type Options = {
  rootSessionKey: (rootId: string, sessionKey: string) => string;
  isCancelled: () => boolean;
  sessionCacheRef: React.RefObject<Record<string, Session>>;
  loadingSessionRef: React.RefObject<
    Partial<Record<string, Promise<SyncSessionResult>>>
  >;
  restoreActiveSession: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
    canApply?: () => boolean,
  ) => Promise<Session | null>;
  loadedSessionRef: React.RefObject<Record<string, boolean>>;
  clearSessionStale: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
  ) => void;
  selectedSessionRef: React.RefObject<SessionItem | null>;
  setSelectedSession: React.Dispatch<React.SetStateAction<SessionItem | null>>;
  boundSessionByRootRef: React.RefObject<Record<string, string | null>>;
  setDrawerSessionForRoot: (
    rootID: string | null | undefined,
    session: Session | SessionItem | null,
  ) => void;
  selectedSessionByRootRef: React.RefObject<Record<string, string | null>>;
  drawerSessionByRootRef: React.RefObject<Record<string, SessionItem | null>>;
  currentRootIdRef: React.RefObject<string | null>;
  managedRootIdsRef: React.RefObject<Set<string>>;
  markSessionStale: (
    rootID: string | null | undefined,
    sessionKey: string | null | undefined,
  ) => void;
  updateSessionRelatedFilesForKey: (
    rootID: string,
    sessionKey: string,
    relatedFiles: RelatedFile[],
  ) => void;
};

export function createSessionReplay({
  rootSessionKey,
  isCancelled,
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
}: Options) {
  const completedTurnVersions = new Map<string, number>();

  const advanceTurnVersion = (rootID: string, sessionKey: string) => {
    const key = rootSessionKey(rootID, sessionKey);
    const version = (completedTurnVersions.get(key) || 0) + 1;
    completedTurnVersions.set(key, version);
    return version;
  };

  const reloadSessionForReplay = async (
    rootID: string,
    sessionKey: string,
    completedVersion?: number,
  ) => {
    if (!rootID || !sessionKey) return;
    const cacheKey = rootSessionKey(rootID, sessionKey);
    const canApply = () =>
      !isCancelled() &&
      (completedVersion === undefined ||
        (completedTurnVersions.get(cacheKey) === completedVersion &&
          !(
            sessionCacheRef.current[cacheKey] as Session & { pending?: boolean }
          )?.pending));
    if (completedVersion !== undefined) {
      // A read started before completion cannot contain the final turn aux.
      // Wait for it before requesting the newly persisted result.
      await loadingSessionRef.current[cacheKey]?.catch(() => {});
    }
    if (!canApply()) return;
    const restored = await restoreActiveSession(rootID, sessionKey, canApply);
    if (!canApply() || !restored) return;
    loadedSessionRef.current[cacheKey] = true;
    clearSessionStale(rootID, sessionKey);
    if (
      (selectedSessionRef.current?.key ||
        selectedSessionRef.current?.session_key) === sessionKey
    ) {
      setSelectedSession((prev) =>
        prev
          ? toSessionItem(rootID, {
              ...(prev as any),
              ...(restored as any),
            })
          : prev,
      );
    }
    if (boundSessionByRootRef.current[rootID] === sessionKey) {
      setDrawerSessionForRoot(rootID, restored);
    }
  };

  const getReplayTargetsForRoot = (rootID: string): string[] => {
    if (!rootID) return [];
    const keys = new Set<string>();
    const rememberedSelectedKey =
      selectedSessionByRootRef.current[rootID] || "";
    if (
      rememberedSelectedKey &&
      !rememberedSelectedKey.startsWith("pending-")
    ) {
      keys.add(rememberedSelectedKey);
    }
    const boundKey = boundSessionByRootRef.current[rootID] || "";
    if (boundKey && !boundKey.startsWith("pending-")) {
      keys.add(boundKey);
    }
    const drawerKey = drawerSessionByRootRef.current[rootID]?.key || "";
    if (drawerKey && !drawerKey.startsWith("pending-")) {
      keys.add(drawerKey);
    }
    const selected = selectedSessionRef.current;
    const selectedKey = selected?.key || selected?.session_key || "";
    const selectedRoot =
      (selected?.root_id as string | undefined) || currentRootIdRef.current;
    if (
      selectedRoot === rootID &&
      selectedKey &&
      !selectedKey.startsWith("pending-")
    ) {
      keys.add(selectedKey);
    }
    return Array.from(keys);
  };

  const replayTargetsForAllRoots = () => {
    const replayCacheKeys = new Set<string>();
    for (const rootID of managedRootIdsRef.current) {
      if (!rootID) continue;
      const replayTargets = getReplayTargetsForRoot(rootID);
      for (const sessionKey of replayTargets) {
        replayCacheKeys.add(rootSessionKey(rootID, sessionKey));
        void reloadSessionForReplay(rootID, sessionKey);
      }
    }
    for (const cacheKey of Object.keys(sessionCacheRef.current)) {
      if (replayCacheKeys.has(cacheKey)) {
        continue;
      }
      const separator = cacheKey.indexOf("::");
      if (separator <= 0) {
        continue;
      }
      const rootID = cacheKey.slice(0, separator);
      const sessionKey = cacheKey.slice(separator + 2);
      if (
        !rootID ||
        !sessionKey ||
        !hasSessionExchanges(sessionCacheRef.current[cacheKey])
      ) {
        continue;
      }
      markSessionStale(rootID, sessionKey);
    }
  };

  const refreshSessionRelatedFiles = async (
    rootID: string,
    sessionKey: string,
  ) => {
    if (!rootID || !sessionKey) return;
    const relatedFiles = await sessionService.getSessionRelatedFiles(
      rootID,
      sessionKey,
    );
    if (isCancelled()) return;
    await setCachedSessionRelatedFiles(rootID, sessionKey, relatedFiles);
    updateSessionRelatedFilesForKey(rootID, sessionKey, relatedFiles);
  };
  return {
    advanceTurnVersion,
    reloadSessionForReplay,
    replayTargetsForAllRoots,
    refreshSessionRelatedFiles,
  };
}
