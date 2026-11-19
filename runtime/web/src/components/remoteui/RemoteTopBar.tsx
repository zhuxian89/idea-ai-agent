import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import {
  APPEARANCE_CHANGE_EVENT,
  getAppearanceMode,
  setAppearanceMode,
  type AppearanceMode,
} from "../../services/appearance";

export const OPEN_AGENT_CONFIG_SWITCH_EVENT = "mindfs:open-agent-config-switch";

const THEME_OPTIONS: Array<{ value: AppearanceMode; labelKey: "appearance.light" | "appearance.dark" | "appearance.meadow" | "appearance.moss" | "appearance.system" }> = [
  { value: "light", labelKey: "appearance.light" },
  { value: "dark", labelKey: "appearance.dark" },
  { value: "meadow", labelKey: "appearance.meadow" },
  { value: "moss", labelKey: "appearance.moss" },
  { value: "system", labelKey: "appearance.system" },
];

/** 侧栏开关：圆角方框加一条竖栏，竖栏有填充表示该栏已展开。 */
export function PanelToggle({ side, open, label, onClick }: { side: "left" | "right"; open: boolean; label: string; onClick?: () => void }) {
  const barX = side === "left" ? 3.8 : 14.8;
  const dividerX = side === "left" ? 9.5 : 14.5;
  return (
    <button type="button" className="remote-panel-toggle" data-side={side} aria-expanded={open} aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x={barX} y="5.8" width="5.4" height="12.4" rx="1.6" fill="currentColor" fillOpacity={open ? 0.32 : 0} stroke="none" />
        <rect x="3" y="4.5" width="18" height="15" rx="3.2" />
        <path d={`M${dividerX} 4.5v15`} />
      </svg>
    </button>
  );
}

export type RemoteTopBarProps = {
  leftToggle?: { open: boolean; label: string; onClick?: () => void } | null;
  rightToggle?: { open: boolean; label: string; onClick?: () => void } | null;
  multiProjectSessionsEnabled?: boolean;
  onMultiProjectSessionsChange?: (enabled: boolean) => void;
};

export function RemoteTopBar({ leftToggle, rightToggle, multiProjectSessionsEnabled = false, onMultiProjectSessionsChange }: RemoteTopBarProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AppearanceMode>(() => getAppearanceMode());

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<AppearanceMode>).detail;
      setMode(next || getAppearanceMode());
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, sync);
  }, []);

  return (
    <header className="remote-topbar" data-remote-topbar>
      {leftToggle ? <PanelToggle side="left" {...leftToggle} /> : <span className="remote-topbar-gap" />}
      <span className="remote-topbar-grow" />
      <button
        type="button"
        className="remote-topbar-action"
        aria-label={t("fileTree.switchAgentConfig")}
        aria-haspopup="dialog"
        onClick={() => window.dispatchEvent(new Event(OPEN_AGENT_CONFIG_SWITCH_EVENT))}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h14m-4-4 4 4-4 4M20 16H6m4-4-4 4 4 4" /></svg>
        <span>{t("fileTree.switchAgentConfig")}</span>
      </button>
      <button
        type="button"
        role="switch"
        aria-label={t("fileTree.multiProjectSessions")}
        aria-checked={multiProjectSessionsEnabled}
        className="remote-topbar-action remote-topbar-switch"
        onClick={() => onMultiProjectSessionsChange?.(!multiProjectSessionsEnabled)}
      >
        <span>{t("fileTree.multiProjectSessions")}</span>
        <span className="remote-switch" aria-hidden="true" />
      </button>
      <label className="remote-topbar-theme">
        <span>{t("remote.topbar.theme")}</span>
        <select
          value={mode}
          aria-label={t("remote.topbar.theme")}
          onChange={(event) => {
            const next = event.target.value as AppearanceMode;
            setMode(next);
            setAppearanceMode(next);
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
          ))}
        </select>
      </label>
      {rightToggle ? <PanelToggle side="right" {...rightToggle} /> : <span className="remote-topbar-gap" />}
    </header>
  );
}
