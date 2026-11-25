import { PhoneMoreGroup } from "../remoteui/PhoneMoreHost";
import { APPEARANCE_OPTIONS, LOCALE_OPTIONS } from "../fileTreeModel";
import { ChevronRight } from "../FileTreeIcons";
import { isRemoteWebUi } from "../../services/remoteUi";
import { DeviceModeSelect } from "../remoteui/DeviceModeSelect";
import { setAppearanceMode } from "../../services/appearance";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";
import type { useFileTreeMenus } from "./useFileTreeMenus";
import type { usePhonePanels } from "./usePhonePanels";

type Deps = {
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  phonePanelsApi: ReturnType<typeof usePhonePanels>;
};

export function FileTreeAppearanceGroup({ fileTreeMenuBehaviorApi, fileTreeMenusApi, phonePanelsApi }: Deps) {
  const { inPhoneMore } = fileTreeMenuBehaviorApi;
  const { appearanceMode, isAppearanceMenuOpen, isLocaleMenuOpen, locale, setAppearanceModeState, setIsAppearanceMenuOpen, setIsLocaleMenuOpen, setIsMenuOpen, setIsSortMenuOpen, setLocale, t } = fileTreeMenusApi;
  const { glowSettingsButton } = phonePanelsApi;
  return (
    !inPhoneMore && <PhoneMoreGroup phone={false} name="appearance" title={t("appearance.title")}>
      <button
        type="button"
        onClick={() => {
          setIsAppearanceMenuOpen((open) => !open);
          setIsLocaleMenuOpen(false);
          setIsSortMenuOpen(false);
        }}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          color: "var(--text-primary)",
          borderRadius: "8px",
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          textAlign: "left",
          cursor: "pointer",
          fontSize: "12px",
        }}
        aria-expanded={isAppearanceMenuOpen}
      >
        <span style={{ flex: 1 }}>{t("appearance.title")}</span>
        <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
          {t(APPEARANCE_OPTIONS.find((option) => option.value === appearanceMode)?.labelKey || "appearance.system")}
        </span>
        <ChevronRight isOpen={isAppearanceMenuOpen} />
      </button>
      {isRemoteWebUi && !inPhoneMore ? <DeviceModeSelect className="remote-shell-only remote-device-mode" /> : null}
      {isAppearanceMenuOpen ? APPEARANCE_OPTIONS.map((option) => {
        const active = option.value === appearanceMode;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setAppearanceMode(option.value);
              setAppearanceModeState(option.value);
              setIsMenuOpen(false);
              setIsAppearanceMenuOpen(false);
              setIsLocaleMenuOpen(false);
              setIsSortMenuOpen(false);
            }}
            style={{
              width: "100%",
              border: "none",
              background: active ? "var(--selection-bg)" : "transparent",
              color: active ? "var(--accent-color)" : "var(--text-primary)",
              borderRadius: "8px",
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              textAlign: "left",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            <span>{t(option.labelKey)}</span>
            <span style={{ fontSize: "11px", opacity: active ? 1 : 0 }}>✓</span>
          </button>
        );
      }) : null}
      <button
        type="button"
        onClick={() => {
          setIsLocaleMenuOpen((open) => !open);
          setIsAppearanceMenuOpen(false);
          setIsSortMenuOpen(false);
        }}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          color: "var(--text-primary)",
          borderRadius: "8px",
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          textAlign: "left",
          cursor: "pointer",
          fontSize: "12px",
        }}
        aria-expanded={isLocaleMenuOpen}
      >
        <span style={{ flex: 1 }}>{t("locale.language")}</span>
        <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
          {t(LOCALE_OPTIONS.find((option) => option.value === locale)?.labelKey || "locale.zhCN")}
        </span>
        <ChevronRight isOpen={isLocaleMenuOpen} />
      </button>
      {isLocaleMenuOpen ? LOCALE_OPTIONS.map((option) => {
        const active = option.value === locale;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setLocale(option.value);
              setIsMenuOpen(false);
              setIsAppearanceMenuOpen(false);
              setIsLocaleMenuOpen(false);
              setIsSortMenuOpen(false);
            }}
            style={{
              width: "100%",
              border: "none",
              background: active ? "var(--selection-bg)" : "transparent",
              color: active ? "var(--accent-color)" : "var(--text-primary)",
              borderRadius: "8px",
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              textAlign: "left",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            <span>{t(option.labelKey)}</span>
            <span style={{ fontSize: "11px", opacity: active ? 1 : 0 }}>✓</span>
          </button>
        );
      }) : null}
      {glowSettingsButton}
      </PhoneMoreGroup>
  );
}
