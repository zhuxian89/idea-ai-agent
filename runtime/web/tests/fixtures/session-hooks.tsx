import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionCache } from "../../src/app/useSessionCache";
import { useSessionNavigation } from "../../src/app/useSessionNavigation";
import { useMessageSending } from "../../src/app/useMessageSending";
import { sessionService } from "../../src/services/session";

const noop = () => {};
const key = (root, session) => `${root}::${session}`;
const ref = (current) => ({ current });

// Real React state and the actual cache/navigation/sending hooks. Only service
// responses and surrounding panels are replaced by this fixture.
export function SessionHooksFixture() {
  const [root, setCurrentRootId] = useState("root");
  const [selected, setSelectedSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setSelectedSessionLoading] = useState(false);
  const [interaction, setInteractionMode] = useState("main");
  const [cacheVersion, setCacheVersion] = useState(0);
  const [pendingPlanMode, setPendingPlanMode] = useState(false);
  const [slashCommandResults, setSlashCommandResults] = useState({});
  const [tabs, setOpenSessionTabsByRoot] = useState({});
  const [url, replaceURLState] = useState(null);
  const refs = useRef(null);
  if (!refs.current)
    refs.current = {
      currentRootIdRef: ref(root),
      selectedSessionRef: ref(selected),
      sessionsRef: ref(sessions),
      interactionModeRef: ref(interaction),
      sessionCacheRef: ref({}),
      currentSessionRef: ref(null),
      drawerSessionByRootRef: ref({}),
      boundSessionByRootRef: ref({}),
      selectedSessionByRootRef: ref({}),
      pendingBySessionRef: ref({}),
      pendingRequestRef: ref({}),
      pendingDraftRef: ref(null),
      loadedSessionRef: ref({}),
      loadingSessionRef: ref({}),
      staleSessionKeysRef: ref(new Set()),
      lastMainSessionSnapshotRef: ref(null),
      cancelRequestedBySessionRef: ref({}),
      mainViewPreferenceByRootRef: ref({}),
      sessionSearchTargetCounterRef: ref(0),
      fileCursorRef: ref(0),
      fileRef: ref(null),
      pluginBypassRef: ref(false),
      pluginQueryRef: ref({}),
      pluginManagerRef: ref(null),
      handleSelectSessionRef: ref(null),
    };
  const r = refs.current;
  useEffect(() => {
    r.currentRootIdRef.current = root;
  }, [root]);
  useEffect(() => {
    r.selectedSessionRef.current = selected;
  }, [selected]);
  useEffect(() => {
    r.sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    r.interactionModeRef.current = interaction;
  }, [interaction]);
  const bumpCacheVersion = useCallback(() => setCacheVersion((v) => v + 1), []);
  const setBoundSessionForRoot = useCallback((root, value) => {
    r.boundSessionByRootRef.current[root] = value;
  }, []);
  const setDrawerSessionForRoot = useCallback((root, value) => {
    r.drawerSessionByRootRef.current[root] = value;
  }, []);
  const openSessionTab = useCallback(
    (root, session) =>
      setOpenSessionTabsByRoot((prev) => ({
        ...prev,
        [root]: [...(prev[root] || []), session],
      })),
    [],
  );
  const removeSessionTabs = useCallback(
    (root, keys) =>
      setOpenSessionTabsByRoot((prev) => ({
        ...prev,
        [root]: (prev[root] || []).filter((s) => !keys.has(s.key)),
      })),
    [],
  );
  const setMainViewPreferenceForRoot = useCallback((root, view) => {
    r.mainViewPreferenceByRootRef.current[root] = view;
  }, []);
  const common = {
    ...r,
    rootSessionKey: key,
    t: (key) => key,
    cacheVersion,
    sessions,
    setCurrentRootId,
    setSelectedSession,
    setSelectedSessionLoading,
    setSessions,
    setInteractionMode,
    bumpCacheVersion,
    setBoundSessionForRoot,
    setDrawerSessionForRoot,
    setOpenSessionTabsByRoot,
    openSessionTab,
    removeSessionTabs,
    setMainViewPreferenceForRoot,
    replaceURLState,
    setMultiProjectSessionPending: noop,
    setDrawerOpenForRoot: noop,
    setPendingPlanMode,
  };
  const cache = useSessionCache(common);
  const restoreActiveSession = useCallback(
    (root, session) =>
      new Promise((resolve) => {
        window.restores[key(root, session)] = resolve;
      }),
    [],
  );
  const navigation = useSessionNavigation({
    ...common,
    ...cache,
    restoreActiveSession,
    setSelectedDir: noop,
    setSelectedDirKey: noop,
    isMobile: false,
    setIsRightOpen: noop,
    setGitDiff: noop,
    setFile: noop,
    setMainEntries: noop,
    setPluginQuery: noop,
    setIsLeftOpen: noop,
    setMultiProjectSessionGroups: noop,
    pluginQuery: {},
    setSyncingSessionKeys: noop,
    loadSessionsForRoot: async () => {},
  });
  const sending = useMessageSending({
    ...common,
    ...cache,
    pendingPlanMode,
    slashCommandResults,
    setSlashCommandResults,
    clearSlashCommandResultForSession: noop,
    attachedFileContext: null,
  });
  window.sessionFixture = {
    select: navigation.handleSelectSession,
    send: sending.handleSendMessage,
    seed(session, drawerSession) {
      setSessions(session ? [session] : []);
      setSelectedSession(session);
      if (session)
        r.sessionCacheRef.current[key(session.root_id, session.key)] = session;
      if (drawerSession) {
        r.sessionCacheRef.current[key("root", drawerSession.key)] =
          drawerSession;
        setBoundSessionForRoot("root", drawerSession.key);
        setDrawerSessionForRoot("root", drawerSession);
      }
    },
    snapshot: () => ({
      root,
      selected,
      loading,
      sessions,
      tabs,
      url,
      pending: r.pendingRequestRef.current,
      cache: r.sessionCacheRef.current,
      drawer: r.drawerSessionByRootRef.current,
    }),
  };
  return <output data-testid="selection">{selected?.key || "none"}</output>;
}

window.restores = {};
window.sent = [];
sessionService.sendMessage = (...args) => {
  window.sent.push(args);
  return new Promise((resolve) => {
    window.finishSend = resolve;
  });
};
