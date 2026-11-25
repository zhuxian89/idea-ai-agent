import { useFileTreePWAAndTips } from "../useFileTreePWAAndTips";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  props: Pick<FileTreeProps, "onGoHome"> & Required<Pick<FileTreeProps, "footerTop" | "relayActionHelp" | "relayActionLabel" | "relayNoRelayer" | "updateActionHelp" | "updateActionLabel">>;
};

export function useFooterState({ fileTreeMenusApi, props }: Deps) {
  const { isNativeApp, protectedAPIReady } = fileTreeMenusApi;
  const { footerTop, onGoHome, relayActionHelp, relayActionLabel, relayNoRelayer, updateActionHelp, updateActionLabel } = props;

  const {
    installLabel,
    installHelp,
    shouldShowInstallButton,
    shouldShowInstallHelp,
    handleInstall,
    relayTip,
    shouldShowRelayTip,
    shouldShowNextRelayTip,
    dismissRelayTip,
    openRelayTip,
    showNextRelayTip,
  } = useFileTreePWAAndTips({
    relayNoRelayer,
    isNativeApp,
    protectedAPIReady,
  });
  const hasFooterContent =
    !!footerTop ||
    !!updateActionLabel ||
    !!updateActionHelp ||
    !!relayActionLabel ||
    !!relayActionHelp ||
    shouldShowRelayTip ||
    (isNativeApp && !!onGoHome) ||
    shouldShowInstallButton ||
    shouldShowInstallHelp;

  return { dismissRelayTip, handleInstall, hasFooterContent, installHelp, installLabel, openRelayTip, relayTip, shouldShowInstallButton, shouldShowInstallHelp, shouldShowNextRelayTip, shouldShowRelayTip, showNextRelayTip };
}
