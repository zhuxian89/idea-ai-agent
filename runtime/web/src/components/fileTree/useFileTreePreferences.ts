import React from "react";
import {
  fetchIdleSessionResourceReleasePreference,
  fetchNewProjectMetaLocationPreference,
} from "../../services/preferences";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useFileTreePreferenceState } from "./useFileTreePreferenceState";
import type { useAgentLifecycleState } from "./useAgentLifecycleState";
import type { useAgentConfigFlow } from "./useAgentConfigFlow";
import type { useRelayServices } from "./useRelayServices";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  fileTreePreferenceStateApi: ReturnType<typeof useFileTreePreferenceState>;
  agentLifecycleStateApi: ReturnType<typeof useAgentLifecycleState>;
  agentConfigFlowApi: ReturnType<typeof useAgentConfigFlow>;
  relayServicesApi: ReturnType<typeof useRelayServices>;
};

export function useFileTreePreferences({ fileTreeMenusApi, fileTreePreferenceStateApi, agentLifecycleStateApi, agentConfigFlowApi, relayServicesApi }: Deps) {
  const { protectedAPIReady, setIsMenuOpen } = fileTreeMenusApi;
  const { setIdleReleaseHours, setIdleReleaseOpen, setNewProjectMetaLocation, setSessionNamingOpen } = fileTreePreferenceStateApi;
  const { setAgentLifecycleOpen } = agentLifecycleStateApi;
  const { setAgentConfigPresentation } = agentConfigFlowApi;
  const { setRelayServicesOpen } = relayServicesApi;

  React.useEffect(() => {
    if (!protectedAPIReady) return;
    let cancelled = false;
    fetchIdleSessionResourceReleasePreference()
      .then((preference) => {
        if (!cancelled) setIdleReleaseHours(String(preference.hours));
      })
      .catch(() => {});
    fetchNewProjectMetaLocationPreference()
      .then((location) => {
        if (!cancelled) setNewProjectMetaLocation(location);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [protectedAPIReady]);
  const openSessionNaming = React.useCallback(() => {
    setIdleReleaseOpen(false);
    setAgentConfigPresentation(null);
    setAgentLifecycleOpen(false);
    setRelayServicesOpen(false);
    setIsMenuOpen(false);
    setSessionNamingOpen(true);
  }, []);
  const openIdleSessionResourceRelease = React.useCallback(() => {
    setAgentConfigPresentation(null);
    setAgentLifecycleOpen(false);
    setRelayServicesOpen(false);
    setSessionNamingOpen(false);
    setIsMenuOpen(false);
    setIdleReleaseOpen(true);
  }, []);

  return { openIdleSessionResourceRelease, openSessionNaming };
}
