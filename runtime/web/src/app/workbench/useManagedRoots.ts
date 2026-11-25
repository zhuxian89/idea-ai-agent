import { useState, useRef, useCallback } from "react";
import { ManagedRootPayload } from "../projectModel";
import { type FileEntry } from "../../services/directorySort";
import { bootstrapService } from "../../services/bootstrap";
import { protectedJSON as apiProtectedJSON, ProtectedAPIError } from "../../services/api";
import { appPath } from "../../services/base";
import { mapManagedRootsToEntries } from "../urlState";
import type { useAppFoundation } from "./useAppFoundation";
import type { useSessionSelection } from "./useSessionSelection";
import type { useProjectTree } from "./useProjectTree";
import type { useRelayConnection } from "./useRelayConnection";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  projectTreeApi: ReturnType<typeof useProjectTree>;
  relayConnectionApi: ReturnType<typeof useRelayConnection>;
};

export function useManagedRoots({ appFoundationApi, sessionSelectionApi, projectTreeApi, relayConnectionApi }: Deps) {
  const { boundSessionByRootRef, drawerOpenByRootRef, drawerSessionByRootRef, invalidTreeCacheKeysRef, loadedSessionRef, mainViewPreferenceByRootRef, managedRootIdsRef, pluginsLoadedByRootRef, pluginsLoadingByRootRef, selectedSessionByRootRef, sessionCacheRef, staleSessionKeysRef, suppressedAutoBindSessionByRootRef } = appFoundationApi;
  const managedRootsRequestRef = useRef<Promise<
    ManagedRootPayload[] | null
  > | null>(null);
  const { setOpenSessionTabsByRoot } = sessionSelectionApi;
  const { entriesByPathRef, setEntriesByPath, setGitHistoryExpandedByRoot, setGitStatusExpandedByRoot } = projectTreeApi;
  const { bootstrapState, handleRelayNavigationFailure } = relayConnectionApi;

  const [managedRootIds, setManagedRootIds] = useState<string[]>([]);
  const managedRootByIdRef = useRef<Record<string, ManagedRootPayload>>({});
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
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

  return { applyManagedRootRename, findManagedRootByPath, loadManagedRootPayloads, managedRootByIdRef, managedRootIds, rootEntries, setManagedRootIds, setRootEntries, startRelayBinding };
}
