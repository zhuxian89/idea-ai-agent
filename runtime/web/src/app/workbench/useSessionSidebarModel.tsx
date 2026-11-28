import { SessionItem } from "../sessionModel";
import { type PhoneSessionFacts } from "../../components/remoteui/phoneSessionFacts";
import { type Session, sessionService } from "../../services/session";
import { type SessionTabItem } from "../../components/SessionTabs";
import type { useAppFoundation } from "./useAppFoundation";
import type { useWorkbenchLayout } from "./useWorkbenchLayout";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useSessionSelection } from "./useSessionSelection";
import type { useManagedRoots } from "./useManagedRoots";
import type { useSessionList } from "./useSessionList";
import type { useSessionCacheState } from "./useSessionCacheState";
import type { useSessionRestore } from "./useSessionRestore";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  sessionListApi: ReturnType<typeof useSessionList>;
  sessionCacheStateApi: ReturnType<typeof useSessionCacheState>;
  sessionRestoreApi: ReturnType<typeof useSessionRestore>;
};

export function useSessionSidebarModel({ appFoundationApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, managedRootsApi, sessionListApi, sessionCacheStateApi, sessionRestoreApi }: Deps) {
  const { sessionCacheRef, t } = appFoundationApi;
  const { phoneFilter, remotePhone } = workbenchLayoutApi;
  const { currentRootId } = currentRootApi;
  const { openSessionTabsByRoot, phoneWaiting, rootSessionKey, selectedSession } = sessionSelectionApi;
  const { managedRootByIdRef } = managedRootsApi;
  const { multiProjectPendingByKey, multiProjectSessionGroups, sessions } = sessionListApi;
  const { resolvePendingForSession } = sessionCacheStateApi;
  const { sessionByKey } = sessionRestoreApi;

  const sessionWithRoot = sessions.map(item => ({ ...item, root_id: item.root_id || currentRootId || undefined }));
  const currentMultiGroup = currentRootId
    ? multiProjectSessionGroups.find(group => group.rootId === currentRootId)
    : undefined;
  const currentPhoneSessions = sessionWithRoot.length
    ? sessionWithRoot
    : currentMultiGroup?.sessions || [];
  const currentTopLevelCount = currentPhoneSessions.filter(item => !item.parent_session_key).length;
  const phoneGroups = remotePhone ? [
    ...(currentRootId ? [{
      rootId: currentRootId,
      rootName: managedRootByIdRef.current[currentRootId]?.display_name || currentMultiGroup?.rootName || currentRootId,
      sessions: currentPhoneSessions,
      totalCount: Math.max(currentTopLevelCount, currentMultiGroup?.totalCount || 0),
    }] : []),
    ...multiProjectSessionGroups.filter(group => group.rootId !== currentRootId),
  ] : [];
  const phoneFactsBySession = new Map<string, PhoneSessionFacts>();
  const getPhoneFacts = (item: SessionItem): PhoneSessionFacts => {
    const root = item.root_id || currentRootId || "";
    const key = rootSessionKey(root, item.key || item.session_key);
    const known = phoneFactsBySession.get(key);
    if (known) return item.search_snippet ? { ...known, preview: item.search_snippet } : known;
    const cached = sessionCacheRef.current[key] as Session | undefined;
    const exchanges = [...(cached?.exchanges || [])].reverse();
    const preview = exchanges.find(entry => (entry.role === "assistant" || entry.role === "user") && entry.content?.trim())?.content?.replace(/\s+/g, " ").trim().slice(0, 140);
    const pending = item.pending || multiProjectPendingByKey[key];
    const ask = pending && exchanges.find(entry => entry.role === "user" || entry.toolCall?.kind === "ask_user")?.toolCall;
    const waiting = phoneWaiting[key] ?? (ask && ["running", "pending", "in_progress"].includes(ask.status || "") ? ask.callId : "");
    const facts: PhoneSessionFacts = {
      state: waiting ? "wait" : sessionService.getSessionFailure(root, item.key) ? "error" : pending ? "work" : "idle",
      project: managedRootByIdRef.current[root]?.display_name || root,
      preview,
      attentionId: waiting || item.updated_at,
    };
    phoneFactsBySession.set(key, facts);
    return item.search_snippet ? { ...facts, preview: item.search_snippet } : facts;
  };
  const filterPhoneSessions = (items: SessionItem[]) => {
    if (!remotePhone || !phoneFilter) return items;
    const selected = new Set(items.filter(item => !item.parent_session_key && getPhoneFacts(item).state === phoneFilter).map(item => item.key));
    return items.filter(item => selected.has(item.key) || (item.parent_session_key && selected.has(item.parent_session_key)));
  };
  const currentOpenSessionTabs: SessionTabItem[] = currentRootId
    ? (openSessionTabsByRoot[currentRootId] || []).map((tab) => {
        const key = tab.key || tab.session_key;
        const selectedKey =
          selectedSession?.key || selectedSession?.session_key;
        const selectedRoot =
          (selectedSession?.root_id as string | undefined) || currentRootId;
        const selected =
          selectedKey === key && selectedRoot === currentRootId
            ? selectedSession
            : null;
        const latest = selected || sessionByKey[key] || tab;
        return {
          key,
          label:
            String(latest?.name || latest?.title || "").trim() ||
            (key.startsWith("pending-")
              ? t("session.new")
              : `Session ${key.slice(0, 8)}`),
          pending: resolvePendingForSession(
            currentRootId,
            key,
            !!latest?.pending,
          ),
        };
      })
    : [];
  const activeSessionTabKey =
    selectedSession &&
    ((selectedSession.root_id as string | undefined) || currentRootId) ===
      currentRootId
      ? selectedSession.key || selectedSession.session_key
      : "";

  return { activeSessionTabKey, currentOpenSessionTabs, filterPhoneSessions, getPhoneFacts, phoneGroups, sessionWithRoot };
}
