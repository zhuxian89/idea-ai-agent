import { PhoneMoreMount } from "../remoteui/PhoneMoreHost";
import { RemotePublishedUpdate } from "../remote/RemoteBrowserUpdate";
import { remoteProjectPrefix } from "../../services/remoteScope";
import { hostPath } from "../../services/base";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useFooterState } from "./useFooterState";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";
import type { FileTreeProps } from "../fileTreeModel";

import { FileTreeRelayTip } from "./FileTreeRelayTip";
import { FileTreeUpdateNotes } from "./FileTreeUpdateNotes";

type Deps = {
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  footerStateApi: ReturnType<typeof useFooterState>;
  props: Pick<FileTreeProps, "onGoHome" | "onRelayAction" | "onUpdateAction" | "publicStandaloneVersion"> & Required<Pick<FileTreeProps, "footerTop" | "relayActionDisabled" | "relayActionHelp" | "relayActionLabel" | "updateActionBusy" | "updateActionDisabled" | "updateActionHelp" | "updateActionLabel" | "updateActionSummary">>;
};

export function FileTreeFooter({ fileTreeMenuBehaviorApi, fileTreeMenusApi, footerStateApi, props }: Deps) {
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { isNativeApp, moreHost, phoneMore, t } = fileTreeMenusApi;
  const { handleInstall, hasFooterContent, installHelp, installLabel, shouldShowInstallButton, shouldShowInstallHelp } = footerStateApi;
  const { footerTop, onGoHome, onRelayAction, onUpdateAction, publicStandaloneVersion, relayActionDisabled, relayActionHelp, relayActionLabel, updateActionBusy, updateActionDisabled, updateActionHelp, updateActionLabel, updateActionSummary } = props;
  return (
    <PhoneMoreMount host={moreHost}>
    <div
      data-mindfs-filetree-footer="1"
      style={{
        padding: hasFooterContent ? "10px 12px 12px" : "0",
        borderTop: hasFooterContent ? "1px solid var(--border-color)" : "none",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        flexShrink: 0,
      }}
    >
      <FileTreeUpdateNotes fileTreeMenusApi={fileTreeMenusApi} props={{ onUpdateAction, updateActionBusy, updateActionDisabled, updateActionHelp, updateActionLabel, updateActionSummary }} />
      {updateActionHelp && !updateActionLabel ? (
        <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.5, textAlign: "center" }}>
          {updateActionHelp}
        </div>
      ) : null}
      <FileTreeRelayTip fileTreeMenusApi={fileTreeMenusApi} footerStateApi={footerStateApi} />
      {footerTop}
      {relayActionLabel ? (
        <button
          type="button"
          className="file-tree-relay-action"
          disabled={relayActionDisabled}
          onClick={() => onRelayAction?.()}
        >
          <svg className="rel-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.4" /><rect x="14" y="3" width="7" height="7" rx="1.4" /><rect x="3" y="14" width="7" height="7" rx="1.4" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 17v4" /></svg>
          <span>{relayActionLabel}</span>
          <svg className="rel-ico rel-go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      ) : null}
      {phoneMore?.connection ? <div className="phone-more-connection">
        <span><i data-state={phoneMore.connection} />{t(`action.ws.${phoneMore.connection}`)}</span>
        {relayActionHelp && <span>{relayActionHelp}</span>}
      </div> : relayActionHelp ? (
        <div className="file-tree-footer-note">
          {relayActionHelp}
        </div>
      ) : null}
      {publicStandaloneVersion && <RemotePublishedUpdate version={publicStandaloneVersion} />}
      <div className={inPhoneMore ? "phone-more-links" : "file-tree-platform-actions"}>

      {inPhoneMore && remoteProjectPrefix() ? (
        <a className="phone-more-node" href={hostPath("/")}>{t("fileTree.goHome")}</a>
      ) : null}
      {isNativeApp && onGoHome ? (
        <button
          type="button"
          onClick={() => onGoHome()}
          style={{
            width: "100%",
            border: "1px solid var(--border-color)",
            background: "var(--text-primary)",
            color: "var(--sidebar-bg)",
            borderRadius: "10px",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          <span>{t("fileTree.goHome")}</span>
        </button>
      ) : null}
      {shouldShowInstallButton ? (
        <button
          type="button"
          onClick={() => { void handleInstall(); }}
          style={{
            width: "100%",
            border: "1px solid var(--border-color)",
            background: "transparent",
            color: "var(--text-secondary)",
            borderRadius: "10px",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
            transition: "all 0.15s ease",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M20 16.5v1.5A2 2 0 0 1 18 20H6a2 2 0 0 1-2-2v-1.5" />
          </svg>
          <span>{installLabel}</span>
        </button>
      ) : null}
      {shouldShowInstallHelp ? (
        <div className="file-tree-footer-note">
          {installHelp}
        </div>
      ) : null}
      </div>
    </div>
    </PhoneMoreMount>
  );
}
