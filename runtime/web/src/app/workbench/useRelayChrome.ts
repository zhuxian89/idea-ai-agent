import { useState, useCallback, useMemo } from "react";
import {
  isStandaloneRuntime,
  standaloneVersion,
  isIDEManagedProject,
} from "../../services/ideaBridge";
import { isRelayNodePage } from "../../services/base";
import { openPendingPopup, navigatePopup } from "../popupNavigation";
import {
  shouldShowUpdateButton,
  updateButtonLabel,
  updateSummaryText,
} from "../updatePresentation";
import type { useAppFoundation } from "./useAppFoundation";
import type { useCurrentRoot } from "./useCurrentRoot";
import type { useRelayConnection } from "./useRelayConnection";
import type { useManagedRoots } from "./useManagedRoots";
import type { useAppServices } from "./useAppServices";

type Deps = {
  appFoundationApi: ReturnType<typeof useAppFoundation>;
  currentRootApi: ReturnType<typeof useCurrentRoot>;
  relayConnectionApi: ReturnType<typeof useRelayConnection>;
  managedRootsApi: ReturnType<typeof useManagedRoots>;
  appServicesApi: ReturnType<typeof useAppServices>;
};

export function useRelayChrome({ appFoundationApi, currentRootApi, relayConnectionApi, managedRootsApi, appServicesApi }: Deps) {
  const { t } = appFoundationApi;
  const { currentRootId } = currentRootApi;
  const { relayStatus } = relayConnectionApi;
  const { startRelayBinding } = managedRootsApi;
  const { updateState, updateSubmitting } = appServicesApi;

  const [standaloneRemoteOpen, setStandaloneRemoteOpen] = useState(false);
  const standalonePage = isStandaloneRuntime;
  const publicStandaloneVersion = standalonePage && isRelayNodePage() ? standaloneVersion : undefined;
  const handleRelayAction = useCallback(async () => {
    if (standalonePage) {
      setStandaloneRemoteOpen(true);
      return;
    }
    if (!currentRootId) {
      return;
    }
    const pendingPopup = openPendingPopup();
    const latestStatus = await startRelayBinding();
    const nextStatus = latestStatus || relayStatus;
    if (!nextStatus) {
      pendingPopup?.close();
      return;
    }
    const nodeURL = String(nextStatus?.node_url || "");
    if (nextStatus?.relay_bound && nodeURL) {
      const target = new URL(nodeURL, window.location.origin);
      target.searchParams.set("root", currentRootId);
      navigatePopup(pendingPopup, target.toString());
      return;
    }
    const pendingCode = String(nextStatus?.pending_code || "");
    const nodeName = String(nextStatus?.node_name || "");
    const relayBaseURL = String(nextStatus?.relay_base_url || "");
    if (!pendingCode || !relayBaseURL) {
      pendingPopup?.close();
      return;
    }
    const target = new URL("/bind", relayBaseURL);
    target.searchParams.set("code", pendingCode);
    target.searchParams.set("root", currentRootId);
    if (nodeName) {
      target.searchParams.set("node_name", nodeName);
    }
    navigatePopup(pendingPopup, target.toString());
  }, [currentRootId, startRelayBinding, relayStatus, standalonePage]);
  const relayActionLabel = useMemo(() => {
    if (standalonePage) return t(isRelayNodePage() ? "relay.phoneAccess" : "relay.publicAccess");
    if (isRelayNodePage()) {
      return null;
    }
    if (relayStatus?.no_relayer) {
      return null;
    }
    return t("relay.publicAccess");
  }, [relayStatus, t, standalonePage]);
  const relayActionDisabled =
    !standalonePage && (!currentRootId ||
    (!relayStatus?.relay_bound && !relayStatus?.relay_base_url));
  const showUpdateButton =
    !isIDEManagedProject && shouldShowUpdateButton(updateState);
  const updateBusy =
    updateSubmitting ||
    ["downloading", "installing", "restarting"].includes(
      (updateState.status || "").toLowerCase(),
    );
  const updateLabel = updateButtonLabel(updateState, t);
  const updateHelp = updateState.message || updateSummaryText(updateState, t);
  const updateSummary = updateSummaryText(updateState, t);

  return { handleRelayAction, publicStandaloneVersion, relayActionDisabled, relayActionLabel, setStandaloneRemoteOpen, showUpdateButton, standalonePage, standaloneRemoteOpen, updateBusy, updateHelp, updateLabel, updateSummary };
}
