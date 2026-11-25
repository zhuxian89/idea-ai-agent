import { useRef } from "react";
import { type FilePayload } from "../../services/file";
import { useI18n } from "../../i18n";
import { PluginManager } from "../../plugins/manager";
import { SessionItem, PendingSend, SessionQueueItem } from "../sessionModel";
import { type Session, type SyncSessionResult } from "../../services/session";
import { loadPersistedFileScrollPositions } from "../storagePrefs";
import { ViewerSelection } from "../fileNavigation";

export function useAppFoundation() {
  const { t, locale } = useI18n();
  const pluginManagerRef = useRef<PluginManager>(new PluginManager());
  const managedRootIdsRef = useRef<Set<string>>(new Set());
  const expandedRef = useRef<string[]>([]);
  const selectedDirRef = useRef<string | null>(null);
  const fileRef = useRef<FilePayload | null>(null);
  const selectedSessionRef = useRef<SessionItem | null>(null);
  const lastMainSessionSnapshotRef = useRef<Session | null>(null);
  const currentSessionRef = useRef<SessionItem | null>(null);
  const interactionModeRef = useRef<"main" | "drawer">("main");
  const pendingDraftRef = useRef<PendingSend | null>(null);
  const pendingBySessionRef = useRef<Record<string, PendingSend>>({});
  const pendingRequestRef = useRef<Record<string, PendingSend>>({});
  const queuedMessagesBySessionRef = useRef<Record<string, SessionQueueItem[]>>(
    {},
  );
  const queueFrozenBySessionRef = useRef<Record<string, boolean>>({});
  const optimisticDequeuedIdsRef = useRef<Record<string, Set<string>>>({});
  const cancelRequestedBySessionRef = useRef<Record<string, boolean>>({});
  const sessionCacheRef = useRef<Record<string, Session>>({});
  const loadedSessionRef = useRef<Record<string, boolean>>({});
  const loadingSessionRef = useRef<
    Partial<Record<string, Promise<SyncSessionResult>>>
  >({});
  const staleSessionKeysRef = useRef<Set<string>>(new Set());
  const invalidTreeCacheKeysRef = useRef<Set<string>>(new Set());
  const boundSessionByRootRef = useRef<Record<string, string | null>>({});
  const suppressedAutoBindSessionByRootRef = useRef<
    Record<string, string | null>
  >({});
  const drawerSessionByRootRef = useRef<Record<string, SessionItem | null>>({});
  const selectedSessionByRootRef = useRef<Record<string, string | null>>({});
  const mainViewPreferenceByRootRef = useRef<
    Record<string, "session" | "file" | "directory" | "git-diff">
  >({});
  const drawerOpenByRootRef = useRef<Record<string, boolean>>({});
  const fileCursorRef = useRef<number>(0);
  const fileScrollPositionsRef = useRef<Record<string, number>>(
    loadPersistedFileScrollPositions(),
  );
  const pluginContentRef = useRef<HTMLDivElement | null>(null);
  const viewerSelectionRef = useRef<ViewerSelection | null>(null);
  const lastViewerSelectionRef = useRef<ViewerSelection | null>(null);
  const dismissedSelectionFileRef = useRef<string | null>(null);
  const pluginBypassRef = useRef<boolean>(false);
  const fileOpenRequestRef = useRef(0);
  const pluginsLoadedByRootRef = useRef<Record<string, boolean>>({});
  const pluginsLoadingByRootRef = useRef<Record<string, Promise<void>>>({});
  const pluginsTrustPendingByRootRef = useRef<Record<string, boolean>>({});
  const didInitRef = useRef(false);
  const handleSelectSessionRef = useRef<
    ((session: Partial<SessionItem> | null) => Promise<void>) | null
  >(null);

  return { boundSessionByRootRef, cancelRequestedBySessionRef, currentSessionRef, didInitRef, dismissedSelectionFileRef, drawerOpenByRootRef, drawerSessionByRootRef, expandedRef, fileCursorRef, fileOpenRequestRef, fileRef, fileScrollPositionsRef, handleSelectSessionRef, interactionModeRef, invalidTreeCacheKeysRef, lastMainSessionSnapshotRef, lastViewerSelectionRef, loadedSessionRef, loadingSessionRef, mainViewPreferenceByRootRef, managedRootIdsRef, optimisticDequeuedIdsRef, pendingBySessionRef, pendingDraftRef, pendingRequestRef, pluginBypassRef, pluginContentRef, pluginManagerRef, pluginsLoadedByRootRef, pluginsLoadingByRootRef, pluginsTrustPendingByRootRef, queueFrozenBySessionRef, queuedMessagesBySessionRef, selectedDirRef, selectedSessionByRootRef, selectedSessionRef, sessionCacheRef, staleSessionKeysRef, suppressedAutoBindSessionByRootRef, t, viewerSelectionRef };
}
