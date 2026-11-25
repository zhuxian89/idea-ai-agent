import React from "react";
import type { useAgentLifecycleState } from "./useAgentLifecycleState";
import type { useAgentLifecycle } from "./useAgentLifecycle";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  agentLifecycleStateApi: ReturnType<typeof useAgentLifecycleState>;
  agentLifecycleApi: ReturnType<typeof useAgentLifecycle>;
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
  props: Required<Pick<FileTreeProps, "agentSettingsOnly">>;
};

export function useAgentLifecycleOutsideClick({ agentLifecycleStateApi, agentLifecycleApi, fileTreeMenuBehaviorApi, props }: Deps) {
  const { agentLifecycleOpen, agentLifecyclePopoverRef } = agentLifecycleStateApi;
  const { closeAgentLifecycleFlow } = agentLifecycleApi;
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { agentSettingsOnly } = props;

  React.useEffect(() => {
    if (inPhoneMore || agentSettingsOnly || !agentLifecycleOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!agentLifecyclePopoverRef.current?.contains(event.target as Node)) {
        closeAgentLifecycleFlow();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [inPhoneMore, agentSettingsOnly, agentLifecycleOpen, closeAgentLifecycleFlow]);
}
