import { slashCommandResultForSession } from "../../app/slashCommandResults";
import { SessionViewer } from "../SessionViewer";
import type { useWorkbenchLayout } from "../../app/workbench/useWorkbenchLayout";
import type { useCurrentRoot } from "../../app/workbench/useCurrentRoot";
import type { useSessionSelection } from "../../app/workbench/useSessionSelection";
import type { useFileViewerState } from "../../app/workbench/useFileViewerState";
import type { useManagedRoots } from "../../app/workbench/useManagedRoots";
import type { useWorkbenchSessionNavigation } from "../../app/workbench/useWorkbenchSessionNavigation";
import type { useAgentCatalog } from "../../app/workbench/useAgentCatalog";
import type { useActionHandlers } from "../../app/workbench/useActionHandlers";
import type { useGitFileStats } from "../../app/workbench/useGitFileStats";
import type { useSessionRestore } from "../../app/workbench/useSessionRestore";
import type { useSessionViewModel } from "../../app/workbench/useSessionViewModel";

type Deps = {
  workbenchLayoutApi: ReturnType<typeof useWorkbenchLayout>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  sessionSelectionApi: ReturnType<typeof useSessionSelection>;
  fileViewerStateApi: ReturnType<typeof useFileViewerState>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  workbenchSessionNavigationApi: ReturnType<typeof useWorkbenchSessionNavigation>;
  agentCatalogApi: ReturnType<typeof useAgentCatalog>;
  actionHandlersApi: ReturnType<typeof useActionHandlers>;
  gitFileStatsApi: ReturnType<typeof useGitFileStats>;
  sessionRestoreApi: ReturnType<typeof useSessionRestore>;
  sessionViewModelApi: ReturnType<typeof useSessionViewModel>;
};

export function SelectedSessionView({ workbenchLayoutApi, currentRootApi, sessionSelectionApi, fileViewerStateApi, managedRootsApi, workbenchSessionNavigationApi, agentCatalogApi, actionHandlersApi, gitFileStatsApi, sessionRestoreApi, sessionViewModelApi }: Deps) {
  const { remotePhone } = workbenchLayoutApi;
  const { currentRootId } = currentRootApi;
  const { rootSessionKey, selectedSession, selectedSessionLoading, slashCommandResults } = sessionSelectionApi;
  const { status } = fileViewerStateApi;
  const { managedRootByIdRef } = managedRootsApi;
  const { handleForkAgentMessage } = workbenchSessionNavigationApi;
  const { availableAgents } = agentCatalogApi;
  const { actionHandlers } = actionHandlersApi;
  const { gitFileStatsByPath } = gitFileStatsApi;
  const { selectedSessionSnapshot } = sessionRestoreApi;
  const { handleAskUserAnswer, handleEditUserMessage, handleRemoveSessionRelatedFile, handleSelectedSessionFileClick } = sessionViewModelApi;

  return (
    <SessionViewer
      phone={remotePhone}
      connected={status === "connected"}
      session={selectedSessionSnapshot}
      agents={availableAgents}
      slashCommandResult={slashCommandResultForSession(
        slashCommandResults,
        rootSessionKey,
        selectedSession?.root_id || currentRootId,
        selectedSessionSnapshot,
      )}
      targetSeq={selectedSession?.search_seq}
      targetSeqRequestKey={selectedSession?.search_target_id}
      loading={selectedSessionLoading}
      rootId={selectedSession?.root_id || currentRootId}
      rootPath={
        managedRootByIdRef.current[
          selectedSession?.root_id || currentRootId || ""
        ]?.root_path || null
      }
      gitFileStatsByPath={gitFileStatsByPath}
      onFileClick={handleSelectedSessionFileClick}
      onRootClick={(root) => {
        void actionHandlers.open_dir({
          path: root,
          root,
          isRoot: true,
          forceDirectory: true,
          suppressTreeExpand: true,
        });
      }}
      onRemoveRelatedFile={(path, head, repoPath, repoKind) =>
        void handleRemoveSessionRelatedFile(
          selectedSession?.root_id || currentRootId,
          selectedSessionSnapshot?.key || selectedSessionSnapshot?.session_key,
          path,
          head,
          repoPath,
          repoKind,
        )
      }
      onAskUserAnswer={handleAskUserAnswer}
      onEditUserMessage={handleEditUserMessage}
      onForkAgentMessage={(seq) =>
        void handleForkAgentMessage(
          selectedSession?.root_id || currentRootId,
          selectedSessionSnapshot?.key || selectedSessionSnapshot?.session_key,
          seq,
        )
      }
    />
  );
}
