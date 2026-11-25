import { useI18n } from "../../i18n";
import React from "react";
import { type DirectorySortMode } from "../../services/directorySort";
import { DIRECTORY_SORT_LABEL_KEYS } from "../fileTreeModel";
import { PhoneMoreHostContext } from "../remoteui/PhoneMoreHost";
import { type GlowConfig, loadGlowConfig, GLOW_CHANGE_EVENT } from "../../services/remoteGlow";
import {
  type AppearanceMode,
  getAppearanceMode,
  APPEARANCE_CHANGE_EVENT,
} from "../../services/appearance";
import { bootstrapService } from "../../services/bootstrap";
import { isNativeShellRuntime } from "../../services/runtime";
import { isRemoteWebUi } from "../../services/remoteUi";
import type { FileTreeProps } from "../fileTreeModel";

type Deps = {
  props: Required<Pick<FileTreeProps, "updateActionLabel" | "updateActionSummary">>;
};

export function useFileTreeMenus({ props }: Deps) {
  const { updateActionLabel, updateActionSummary } = props;

  const { locale, setLocale, t } = useI18n();
  const sortLabel = React.useCallback((mode: DirectorySortMode): string => {
    const key = DIRECTORY_SORT_LABEL_KEYS[mode];
    return key ? t(key) : t("directory.defaultSort");
  }, [t]);
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const phoneMore = React.useContext(PhoneMoreHostContext);
  const moreHost = phoneMore?.host ?? null;
  const [phoneBackupOpen, setPhoneBackupOpen] = React.useState(false);
  const [glowDialogOpen, setGlowDialogOpen] = React.useState(false);
  const [glowConfig, setGlowConfig] = React.useState<GlowConfig>(() => loadGlowConfig());
  const closeGlowDialog = React.useCallback(() => setGlowDialogOpen(false), []);
  const [isAppearanceMenuOpen, setIsAppearanceMenuOpen] = React.useState(false);
  const [isLocaleMenuOpen, setIsLocaleMenuOpen] = React.useState(false);
  const [isSortMenuOpen, setIsSortMenuOpen] = React.useState(false);
  const [appearanceMode, setAppearanceModeState] = React.useState<AppearanceMode>(() => getAppearanceMode());
  const [isUpdateNotesOpen, setIsUpdateNotesOpen] = React.useState(false);
  const [protectedAPIReady, setProtectedAPIReady] = React.useState(() =>
    bootstrapService.canUseProtectedAPI(),
  );
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const updateNotesRef = React.useRef<HTMLDivElement | null>(null);
  const [isNativeApp, setIsNativeApp] = React.useState(() => isNativeShellRuntime());
  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const syncAppearanceMode = () => {
      setAppearanceModeState(getAppearanceMode());
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, syncAppearanceMode);
    window.addEventListener("storage", syncAppearanceMode);
    return () => {
      window.removeEventListener(APPEARANCE_CHANGE_EVENT, syncAppearanceMode);
      window.removeEventListener("storage", syncAppearanceMode);
    };
  }, []);
  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const refreshNativeRuntime = () => {
      setIsNativeApp(isNativeShellRuntime());
    };
    refreshNativeRuntime();
    const timers = [250, 1000, 2000].map((delay) => window.setTimeout(refreshNativeRuntime, delay));
    window.addEventListener("mindfs:native-bridge-ready", refreshNativeRuntime);
    window.addEventListener("pageshow", refreshNativeRuntime);
    window.addEventListener("focus", refreshNativeRuntime);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("mindfs:native-bridge-ready", refreshNativeRuntime);
      window.removeEventListener("pageshow", refreshNativeRuntime);
      window.removeEventListener("focus", refreshNativeRuntime);
    };
  }, []);
  React.useEffect(() => {
    return bootstrapService.subscribe(() => {
      setProtectedAPIReady(bootstrapService.canUseProtectedAPI());
    });
  }, []);
  React.useEffect(() => {
    if (!isUpdateNotesOpen || typeof document === "undefined") {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (updateNotesRef.current && !updateNotesRef.current.contains(event.target as Node)) {
        setIsUpdateNotesOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isUpdateNotesOpen]);
  React.useEffect(() => {
    if (!updateActionLabel || !updateActionSummary) {
      setIsUpdateNotesOpen(false);
    }
  }, [updateActionLabel, updateActionSummary]);
  React.useEffect(() => {
    if (!isRemoteWebUi) return;
    const sync = (event: Event) => setGlowConfig((event as CustomEvent<GlowConfig>).detail || loadGlowConfig());
    window.addEventListener(GLOW_CHANGE_EVENT, sync);
    return () => window.removeEventListener(GLOW_CHANGE_EVENT, sync);
  }, []);

  return { appearanceMode, closeGlowDialog, glowConfig, glowDialogOpen, isAppearanceMenuOpen, isLocaleMenuOpen, isMenuOpen, isNativeApp, isSortMenuOpen, isUpdateNotesOpen, locale, menuRef, moreHost, phoneBackupOpen, phoneMore, protectedAPIReady, setAppearanceModeState, setGlowDialogOpen, setIsAppearanceMenuOpen, setIsLocaleMenuOpen, setIsMenuOpen, setIsSortMenuOpen, setIsUpdateNotesOpen, setLocale, setPhoneBackupOpen, sortLabel, t, updateNotesRef };
}
