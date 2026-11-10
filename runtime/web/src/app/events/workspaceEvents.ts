import React from "react";
import type { SessionServiceEvent } from "../../services/session";
import { type UpdateState } from "../../services/update";
import { ManagedRootPayload } from "../projectModel";
import { normalizeUpdateState } from "../updatePresentation";

type Options = {
  applyManagedRootRename: (
    oldRootID: string,
    rootPayload: ManagedRootPayload | null | undefined,
  ) => boolean;
  currentRootIdRef: React.RefObject<string | null>;
  onOpenProject: (
    rootId: string,
    options?: { forceDirectory?: boolean; preservePluginQuery?: boolean },
  ) => Promise<void>;
  refreshManagedRoots: () => Promise<void>;
  setAgentsVersion: React.Dispatch<React.SetStateAction<number>>;
  setUpdateState: React.Dispatch<React.SetStateAction<UpdateState>>;
};

export function createWorkspaceEventHandler({
  applyManagedRootRename,
  currentRootIdRef,
  onOpenProject,
  refreshManagedRoots,
  setAgentsVersion,
  setUpdateState,
}: Options) {
  return (event: SessionServiceEvent) => {
    const payload = (event.payload || {}) as any;
    switch (event.type) {
      case "root.changed":
        if (
          payload?.action === "renamed" &&
          typeof payload?.old_root_id === "string" &&
          typeof payload?.root_id === "string"
        ) {
          const rootPayload =
            payload?.root && typeof payload.root === "object"
              ? ({
                  ...(payload.root as ManagedRootPayload),
                  id: payload.root_id,
                } as ManagedRootPayload)
              : null;
          if (!rootPayload) {
            break;
          }
          applyManagedRootRename(payload.old_root_id, rootPayload);
          if (currentRootIdRef.current === payload.old_root_id) {
            void onOpenProject(payload.root_id, {
              forceDirectory: true,
              preservePluginQuery: true,
            });
          }
          break;
        }
        void refreshManagedRoots();
        break;
      case "agent.status.changed":
        setAgentsVersion((v) => v + 1);
        break;
      case "app.update":
        setUpdateState(normalizeUpdateState(payload?.state as UpdateState));
        break;
    }
  };
}
