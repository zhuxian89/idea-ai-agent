import { createPortal } from "react-dom";
import type { useAgentConfigFlow } from "./useAgentConfigFlow";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useAgentConfigurationView } from "./useAgentConfigurationView";

type Deps = {
  agentConfigFlowApi: ReturnType<typeof useAgentConfigFlow>;
  agentConfigurationViewApi: ReturnType<typeof useAgentConfigurationView>;
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
};

export function FileTreeAgentConfigDialog({ agentConfigFlowApi, agentConfigurationViewApi, fileTreeMenusApi }: Deps) {
  const { agentConfigDialogRef, agentConfigPresentation, agentConfigTitleId, closeAgentConfigFlow } = agentConfigFlowApi;
  const { agentConfiguration } = agentConfigurationViewApi;
  const { t } = fileTreeMenusApi;
  return (
    agentConfigPresentation === "dialog" ? createPortal(
        <dialog
          ref={agentConfigDialogRef}
          className="remote-agent-config-dialog"
          aria-labelledby={agentConfigTitleId}
          onCancel={(event) => {
            event.preventDefault();
            closeAgentConfigFlow();
          }}
        >
          <header>
            <h2 id={agentConfigTitleId}>{t("fileTree.switchAgentConfig")}</h2>
            <button type="button" onClick={closeAgentConfigFlow} aria-label={t("common.close")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>
          {agentConfiguration}
        </dialog>,
        document.body,
      ) : null
  );
}
