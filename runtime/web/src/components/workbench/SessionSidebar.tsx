import { AgentIcon } from "../AgentIcon";
import { ChevronDownSmallIcon, ImportIcon } from "../../app/icons";
import { AgentMenuList } from "../AgentMenuList";
import { SessionItem } from "../../app/sessionModel";
import { ExternalSessionList } from "../ExternalSessionList";
import { isIDEManagedProject, isIdeaRuntime } from "../../services/ideaBridge";
import { isRemoteWebUi } from "../../services/remoteUi";
import { MultiProjectSessionList, SessionList } from "../SessionList";
import type { useAppFoundation } from "../../app/workbench/useAppFoundation";
import type { useSessionDialogs } from "../../app/workbench/useSessionDialogs";
import type { useWorkbenchLayout } from "../../app/workbench/useWorkbenchLayout";
import type { useCurrentRoot } from "../../app/workbench/useCurrentRoot";
import type { useSessionSelection } from "../../app/workbench/useSessionSelection";
import type { useSessionList } from "../../app/workbench/useSessionList";
import type { useWorkbenchSessionNavigation } from "../../app/workbench/useWorkbenchSessionNavigation";
import type { useExternalSessionImport } from "../../app/workbench/useExternalSessionImport";
import type { useAgentCatalog } from "../../app/workbench/useAgentCatalog";
import type { useActionHandlers } from "../../app/workbench/useActionHandlers";

import type { useSessionSidebarModel } from "../../app/workbench/useSessionSidebarModel";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  sessionDialogsApi: ReturnType<typeof useSessionDialogs>;
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  sessionListApi: ReturnType<typeof useSessionList>;
  workbenchSessionNavigationApi: ReturnType<typeof useWorkbenchSessionNavigation>;
  externalSessionImportApi: ReturnType<typeof useExternalSessionImport>;
  agentCatalogApi: ReturnType<typeof useAgentCatalog>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  sessionSidebarModelApi: ReturnType<typeof useSessionSidebarModel>;
  onOpenCollab?: () => void;
  collabWaitingCount?: number;
};

export function SessionSidebar({ appFoundationApi, sessionDialogsApi, workbenchLayoutApi, currentRootApi, sessionSelectionApi, sessionListApi, workbenchSessionNavigationApi, externalSessionImportApi, agentCatalogApi, actionHandlersApi, sessionSidebarModelApi, onOpenCollab, collabWaitingCount = 0 }: Deps) {
  const { t } = appFoundationApi;
  const { setHandoffSession, setScheduledAgentDialogOpen, setScheduledAgentSession } = sessionDialogsApi;
  const { isMobile, phoneFilter, remotePhone, setIsRightOpen } = workbenchLayoutApi;
  const { currentRootId } = currentRootApi;
  const { selectedSession } = sessionSelectionApi;
  const { handleLoadOlderSessions, hasMoreSessions, loadChildSessionsForParent, loadMoreMultiProjectSessions, loadingOlderSessions, multiProjectSessionGroups, multiProjectSessionsEnabled, multiProjectSessionsLoading, sessionListMode, sessionSearchLoading, sessionSearchOpen, sessionSearchQuery, sessionSearchResults, sessionSearchResultsMode, setSessionSearchAppliedQuery, setSessionSearchLoading, setSessionSearchOpen, setSessionSearchQuery, setSessionSearchResults, setSessionSearchResultsMode, syncingSessionKeys } = sessionListApi;
  const { handleDeleteSession, handlePinSession, handleRenameSession, handleSelectSession, handleSyncSession } = workbenchSessionNavigationApi;
  const { confirmingExternalImport, enterImportMode, exitImportMode, externalFilterBound, externalImportAgent, externalSelectedKey, externalSessions, externalSessionsError, handleConfirmExternalImport, handleLoadOlderExternalSessions, hasMoreExternalSessions, importMenuOpen, importMenuRef, importingExternalSessionKeys, loadingExternalSessions, loadingOlderExternalSessions, selectedExternalImportKeys, setExternalFilterBound, setExternalImportAgent, setExternalSelectedKey, setImportMenuOpen, toggleAllExternalImportSelection, toggleExternalImportSelection } = externalSessionImportApi;
  const { availableAgents } = agentCatalogApi;
  const { actionHandlers } = actionHandlersApi;
  const { filterPhoneSessions, phoneGroups, sessionWithRoot } = sessionSidebarModelApi;

  const sessionImportMenu = (
    <div ref={importMenuRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setImportMenuOpen((open) => !open)}
        aria-label={t("externalImport.open")}
        style={{
          border: "none",
          background: "transparent",
          color:
            sessionListMode === "import" && externalImportAgent
              ? "var(--text-secondary)"
              : "#0f766e",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: "34px",
          minWidth: "34px",
          borderRadius: "8px",
          cursor: "pointer",
          padding:
            sessionListMode === "import" && externalImportAgent ? 0 : "0 2px",
        }}
      >
        {sessionListMode === "import" && externalImportAgent ? (
          <>
            <AgentIcon
              agentName={externalImportAgent}
              style={{ width: "14px", height: "14px", display: "block" }}
            />
            <ChevronDownSmallIcon />
          </>
        ) : (
          <ImportIcon />
        )}
      </button>
      {importMenuOpen ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: "260px",
            padding: "10px",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            background: "var(--menu-bg)",
            boxShadow: "0 12px 30px rgba(15, 23, 42, 0.14)",
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            {t("externalImport.chooseAgent")}
          </div>
          <AgentMenuList
            agents={availableAgents}
            selectedAgent={externalImportAgent}
            maxHeight="180px"
            onSelect={(agentName) => {
              setImportMenuOpen(false);
              setExternalImportAgent(agentName);
              setExternalSelectedKey("");
              void enterImportMode(agentName);
            }}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={externalFilterBound}
              onChange={(e) => setExternalFilterBound(e.target.checked)}
            />
            <span>{t("externalImport.hideImported")}</span>
          </label>
        </div>
      ) : null}
    </div>
  );
  const headerActions = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {onOpenCollab && !isRemoteWebUi && !isIdeaRuntime ? (
        <button
          type="button"
          className="collab-entry-btn collab-entry-btn--topcenter"
          onClick={onOpenCollab}
          title={t("collab.entryTitle")}
        >
          <span>{t("collab.entryMode")}</span>
          {collabWaitingCount > 0 ? (
            <span className="collab-entry-badge">{collabWaitingCount}</span>
          ) : null}
        </button>
      ) : null}
      {sessionImportMenu}
    </div>
  );
  const openSessionSchedule = (session: SessionItem) => {
    setScheduledAgentSession({ ...session, root_id: session.root_id || currentRootId || undefined });
    setScheduledAgentDialogOpen(true);
  };
  const openSessionHandoff = (session: SessionItem) => {
    setHandoffSession({ ...session, root_id: session.root_id || currentRootId || undefined });
  };
  return (
    sessionListMode === "import" ? (
      <ExternalSessionList
        sessions={externalSessions}
        selectedKey={externalSelectedKey}
        selectedAgent={externalImportAgent}
        importingKeys={importingExternalSessionKeys}
        selectedImportKeys={selectedExternalImportKeys}
        filterBound={externalFilterBound}
        headerAction={headerActions}
        loading={loadingExternalSessions}
        error={externalSessionsError}
        loadingOlder={loadingOlderExternalSessions}
        confirmingImport={confirmingExternalImport}
        hasMore={hasMoreExternalSessions}
        onBack={exitImportMode}
        onSelect={(session) =>
          setExternalSelectedKey(
            String(session.key || session.session_key || ""),
          )
        }
        onToggleImport={toggleExternalImportSelection}
        onToggleSelectAllImport={toggleAllExternalImportSelection}
        onConfirmImport={() => {
          void handleConfirmExternalImport();
        }}
        onLoadOlder={() => {
          void handleLoadOlderExternalSessions();
        }}
      />
    ) : !isIDEManagedProject &&
      multiProjectSessionsEnabled &&
      !sessionSearchOpen &&
      !sessionSearchResultsMode ? (
      <MultiProjectSessionList
        groups={remotePhone && phoneFilter ? phoneGroups.map(group => ({ ...group, sessions: filterPhoneSessions(group.sessions) })).filter(group => group.sessions.length > 0) : multiProjectSessionGroups}
        selectedKey={selectedSession?.key}
        selectedRootId={
          (selectedSession?.root_id as string | undefined) ||
          currentRootId ||
          ""
        }
        headerAction={headerActions}
        loading={multiProjectSessionsLoading}
        emptyText={t("externalImport.empty")}
        syncingSessionKeys={syncingSessionKeys}
        onSearchToggle={() => {
          setSessionSearchOpen(true);
          setSessionSearchResultsMode(false);
          setSessionSearchQuery("");
          setSessionSearchAppliedQuery("");
          setSessionSearchResults([]);
          setSessionSearchLoading(false);
        }}
        onSelect={(s) => {
          handleSelectSession(s);
          if (isMobile || isIdeaRuntime) setIsRightOpen(false);
        }}
        onSync={handleSyncSession}
        onPin={handlePinSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
        onScheduledTask={openSessionSchedule}
        onHandoffPack={openSessionHandoff}
        onProjectClick={(rootId) => {
          actionHandlers.open_dir({
            path: rootId,
            root: rootId,
            isRoot: true,
            suppressTreeExpand: true,
          });
          if (isMobile) setIsRightOpen(false);
        }}
        onLoadMoreProject={loadMoreMultiProjectSessions}
        onLoadChildren={loadChildSessionsForParent}
      />
    ) : (
      <SessionList
        sessions={
          sessionSearchOpen && sessionSearchResultsMode
            ? sessionSearchResults
            : filterPhoneSessions(sessionWithRoot)
        }
        selectedKey={selectedSession?.key}
        headerAction={headerActions}
        persistentSearch={isIdeaRuntime}
        searchOpen={sessionSearchOpen}
        searchResultsMode={sessionSearchResultsMode}
        searchQuery={sessionSearchQuery}
        searchLoading={sessionSearchLoading}
        syncingSessionKeys={syncingSessionKeys}
        emptyText={
          sessionSearchResultsMode ? (
            sessionSearchLoading ? (
              t("sessionList.searching")
            ) : (
              t("externalImport.noSearchMatch")
            )
          ) : (
            <span>
              {t("externalImport.emptyHintPrefix")}
              <strong style={{ color: "var(--text-primary)", fontWeight: 800 }}>
                {t("externalImport.emptyHintAction")}
              </strong>
            </span>
          )
        }
        onSearchToggle={() => {
          setSessionSearchOpen((prev) => {
            const next = !prev;
            if (!next) {
              setSessionSearchResultsMode(false);
              setSessionSearchQuery("");
              setSessionSearchAppliedQuery("");
              setSessionSearchResults([]);
              setSessionSearchLoading(false);
            }
            return next;
          });
        }}
        onSearchQueryChange={(value) => {
          setSessionSearchQuery(value);
          setSessionSearchAppliedQuery("");
          if (!value.trim()) {
            setSessionSearchOpen(isIdeaRuntime);
            setSessionSearchResultsMode(false);
            setSessionSearchAppliedQuery("");
            setSessionSearchResults([]);
            setSessionSearchLoading(false);
            return;
          }
          setSessionSearchOpen(true);
          setSessionSearchResultsMode(true);
          setSessionSearchResults([]);
          setSessionSearchLoading(true);
        }}
        onSearchBlur={() => {
          setSessionSearchOpen(false);
          setSessionSearchResultsMode(false);
          setSessionSearchQuery("");
          setSessionSearchAppliedQuery("");
          setSessionSearchResults([]);
          setSessionSearchLoading(false);
        }}
        onSearchBack={() => {
          setSessionSearchResultsMode(false);
          setSessionSearchQuery("");
          setSessionSearchAppliedQuery("");
          setSessionSearchResults([]);
          setSessionSearchLoading(false);
          setSessionSearchOpen(false);
        }}
        onSelect={(s) => {
          handleSelectSession(s);
          if (isMobile || isIdeaRuntime) setIsRightOpen(false);
        }}
        onSync={handleSyncSession}
        onPin={handlePinSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
        onScheduledTask={openSessionSchedule}
        onHandoffPack={openSessionHandoff}
        onLoadChildren={
          sessionSearchOpen && sessionSearchResultsMode
            ? undefined
            : loadChildSessionsForParent
        }
        onLoadOlder={
          sessionSearchOpen && sessionSearchResultsMode
            ? undefined
            : handleLoadOlderSessions
        }
        loadingOlder={
          sessionSearchOpen && sessionSearchResultsMode
            ? false
            : loadingOlderSessions
        }
        hasMore={
          sessionSearchOpen && sessionSearchResultsMode
            ? false
            : hasMoreSessions
        }
      />
    )
  );
}
