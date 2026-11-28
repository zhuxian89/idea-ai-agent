import { PhoneMoreMount, PhoneMoreGroup } from "../remoteui/PhoneMoreHost";
import { isRemoteWebUi } from "../../services/remoteUi";
import { fileTreeMenuButtonStyle, WebPushMenuItem } from "../WebPushMenuItem";
import { isIOSAppRuntime, isMacAppRuntime } from "../../services/runtime";
import { BarkMenuItem } from "../notifications/BarkSettings";
import { APPEARANCE_OPTIONS, LOCALE_OPTIONS } from "../fileTreeModel";
import { setAppearanceMode } from "../../services/appearance";
import { DeviceModeSelect } from "../remoteui/DeviceModeSelect";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";
import type { useProjectTreeTab } from "./useProjectTreeTab";
import type { usePhonePanels } from "./usePhonePanels";
import type { useAgentConfigFlow } from "./useAgentConfigFlow";
import type { useAgentLifecycle } from "./useAgentLifecycle";
import type { useAgentLifecycleState } from "./useAgentLifecycleState";
import type { useFileTreePreferenceState } from "./useFileTreePreferenceState";
import type { useFileTreePreferences } from "./useFileTreePreferences";
import type { useRelayServices } from "./useRelayServices";
import type { FileTreeProps } from "../fileTreeModel";

import { FileTreePreferencesGroup } from "./FileTreePreferencesGroup";
import { FileTreeAppearanceGroup } from "./FileTreeAppearanceGroup";
import { FileTreeProjectGroup } from "./FileTreeProjectGroup";

type Deps = {
  agentConfigFlowApi: ReturnType<typeof useAgentConfigFlow>;
  agentLifecycleApi: ReturnType<typeof useAgentLifecycle>;
  agentLifecycleStateApi: ReturnType<typeof useAgentLifecycleState>;
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  fileTreePreferenceStateApi: ReturnType<typeof useFileTreePreferenceState>;
  fileTreePreferencesApi: ReturnType<typeof useFileTreePreferences>;
  phonePanelsApi: ReturnType<typeof usePhonePanels>;
  projectTreeTabApi: ReturnType<typeof useProjectTreeTab>;
  relayServicesApi: ReturnType<typeof useRelayServices>;
  props: Pick<FileTreeProps, "onGitDiffSideBySideChange" | "onMultiProjectSessionsChange" | "onShowHiddenFilesChange" | "onSidebarsSwappedChange" | "onSortModeChange" | "sortMode"> & Required<Pick<FileTreeProps, "gitDiffSideBySide" | "multiProjectSessionsEnabled" | "relayNoRelayer" | "showHiddenFiles" | "sidebarsSwapped">>;
};

export function FileTreeSettingsMenu({ agentConfigFlowApi, agentLifecycleApi, agentLifecycleStateApi, fileTreeMenuBehaviorApi, fileTreeMenusApi, fileTreePreferenceStateApi, fileTreePreferencesApi, phonePanelsApi, projectTreeTabApi, relayServicesApi, props }: Deps) {
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { appearanceMode, isMenuOpen, isNativeApp, locale, moreHost, setAppearanceModeState, setIsMenuOpen, setLocale, t } = fileTreeMenusApi;
  const { glowSettingsButton } = phonePanelsApi;
  const { setProjectTreeTab } = projectTreeTabApi;
  const { gitDiffSideBySide, multiProjectSessionsEnabled, onGitDiffSideBySideChange, onMultiProjectSessionsChange, onShowHiddenFilesChange, onSidebarsSwappedChange, onSortModeChange, relayNoRelayer, showHiddenFiles, sidebarsSwapped, sortMode } = props;
  return (
    isMenuOpen || inPhoneMore ? (
        <PhoneMoreMount host={moreHost}>
        <div
          data-file-tree-menu={inPhoneMore ? undefined : true}
          className={inPhoneMore ? "phone-more-menu" : undefined}
          style={inPhoneMore ? undefined : {
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: "var(--mindfs-file-menu-width, 182px)",
            maxWidth: "calc(100vw - 16px)",
            overflowY: isRemoteWebUi ? "auto" : undefined,
            overscrollBehaviorY: isRemoteWebUi ? "contain" : undefined,
            padding: "6px",
            boxSizing: "border-box",
            whiteSpace: "nowrap",
            borderRadius: "10px",
            border: "1px solid var(--border-color)",
            background: "var(--menu-bg)",
            boxShadow: "0 12px 30px rgba(15, 23, 42, 0.14)",
            zIndex: 20,
          }}
        >

            {isRemoteWebUi && !inPhoneMore ? (
              <div className="remote-shell-only" role="group" aria-label={t("fileTree.projectTools")}>
                <div className="remote-menu-heading">{t("fileTree.projectTools")}</div>
                {([
                  ["git", t("git.changes")],
                  ["worktrees", t("fileTree.worktrees")],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" style={fileTreeMenuButtonStyle} onClick={() => { setProjectTreeTab(value); setIsMenuOpen(false); }}>
                    <span>{label}</span>
                  </button>
                ))}
                <div style={{ height: "1px", background: "var(--border-color)", margin: "6px 4px" }} />
              </div>
            ) : null}
            <FileTreeProjectGroup agentConfigFlowApi={agentConfigFlowApi} agentLifecycleApi={agentLifecycleApi} agentLifecycleStateApi={agentLifecycleStateApi} fileTreeMenuBehaviorApi={fileTreeMenuBehaviorApi} fileTreeMenusApi={fileTreeMenusApi} fileTreePreferenceStateApi={fileTreePreferenceStateApi} fileTreePreferencesApi={fileTreePreferencesApi} relayServicesApi={relayServicesApi} props={{ relayNoRelayer }} />
            <PhoneMoreGroup phone={inPhoneMore} name="notifications" title={t("remote.phone.notifications")}>
              {!isNativeApp && !isIOSAppRuntime() && !isMacAppRuntime() ? <WebPushMenuItem phone={inPhoneMore} /> : null}
              <BarkMenuItem phone={inPhoneMore} />
            </PhoneMoreGroup>
            {!inPhoneMore && <div style={{ height: "1px", background: "var(--border-color)", margin: "6px 4px" }} />}
            <FileTreeAppearanceGroup fileTreeMenuBehaviorApi={fileTreeMenuBehaviorApi} fileTreeMenusApi={fileTreeMenusApi} phonePanelsApi={phonePanelsApi} />
            {!inPhoneMore && <div style={{ height: "1px", background: "var(--border-color)", margin: "6px 4px" }} />}
            <FileTreePreferencesGroup fileTreeMenuBehaviorApi={fileTreeMenuBehaviorApi} fileTreeMenusApi={fileTreeMenusApi} fileTreePreferenceStateApi={fileTreePreferenceStateApi} props={{ gitDiffSideBySide, multiProjectSessionsEnabled, onGitDiffSideBySideChange, onMultiProjectSessionsChange, onShowHiddenFilesChange, onSidebarsSwappedChange, onSortModeChange, showHiddenFiles, sidebarsSwapped, sortMode }} />
            {inPhoneMore && <>
              <PhoneMoreGroup phone name="appearance" title={t("appearance.title")}>
                <div className="phone-more-choice phone-more-themes" role="group" aria-label={t("remote.topbar.theme")}>
                  {APPEARANCE_OPTIONS.map(option => <button type="button" key={option.value} aria-pressed={appearanceMode === option.value} onClick={() => { setAppearanceMode(option.value); setAppearanceModeState(option.value); }}>
                    <i data-theme-option={option.value} aria-hidden="true" />{t(option.labelKey)}
                  </button>)}
                </div>
                <div className="phone-more-choice" role="group" aria-label={t("locale.language")}>
                  <span className="phone-more-choice-label">{t("locale.language")}</span>
                  {LOCALE_OPTIONS.map(option => <button type="button" key={option.value} aria-pressed={locale === option.value} onClick={() => setLocale(option.value)}>{t(option.labelKey)}</button>)}
                </div>
                {glowSettingsButton}
              </PhoneMoreGroup>
              <PhoneMoreGroup phone name="device" title={t("remote.device.title")}>
                <DeviceModeSelect className="phone-more-choice" segmented />
              </PhoneMoreGroup>
            </>}
        </div>
        </PhoneMoreMount>
      ) : null
  );
}
