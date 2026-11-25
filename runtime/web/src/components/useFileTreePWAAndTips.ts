import React from "react";
import { useI18n } from "../i18n";
import { protectedJSON } from "../services/api";
import { appPath } from "../services/base";
import { openExternalURL } from "../services/platformNavigation";
import { isIOSAppRuntime, shouldEnablePWAInstall } from "../services/runtime";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type RelayTip = {
  id: string;
  badge?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  cta_label?: string;
  href?: string;
  target?: "_blank" | "_self";
  dismissible?: boolean;
};

const PWA_INSTALL_STATE_KEY = "mindfs-pwa-installed";
const RELAYER_AD_DISMISS_STORAGE_KEY = "mindfs-relayer-ad-dismissed";

export function useFileTreePWAAndTips({
  relayNoRelayer,
  isNativeApp,
  protectedAPIReady,
}: {
  relayNoRelayer: boolean;
  isNativeApp: boolean;
  protectedAPIReady: boolean;
}) {
  const { t } = useI18n();
  const [deferredInstallPrompt, setDeferredInstallPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = React.useState(false);
  const [isInstallCapable, setIsInstallCapable] = React.useState(false);
  const [relayTips, setRelayTips] = React.useState<RelayTip[]>([]);
  const [activeRelayTipIndex, setActiveRelayTipIndex] = React.useState(0);
  const [dismissedRelayTipIds, setDismissedRelayTipIds] = React.useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    try {
      const raw = window.localStorage.getItem(RELAYER_AD_DISMISS_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      }
      return typeof parsed === "string" && parsed.trim().length > 0 ? [parsed] : [];
    } catch {
      try {
        const legacy = window.localStorage.getItem(RELAYER_AD_DISMISS_STORAGE_KEY);
        return legacy && legacy.trim().length > 0 ? [legacy] : [];
      } catch {
        return [];
      }
    }
  });

  const isIOS = React.useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const ua = window.navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  }, []);

  const isMacSafari = React.useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const ua = window.navigator.userAgent;
    const isMac = ua.includes("Macintosh");
    const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|CriOS|FxiOS/.test(ua);
    return isMac && isSafari;
  }, []);

  const isAndroidChrome = React.useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const ua = window.navigator.userAgent;
    const isAndroid = /Android/i.test(ua);
    const isChrome = /Chrome|Chromium/i.test(ua);
    const isExcluded = /EdgA|OPR|SamsungBrowser|Firefox|QQBrowser|MQQBrowser|UCBrowser|HuaweiBrowser|MiuiBrowser|VivoBrowser|HeyTapBrowser/i.test(ua);
    return isAndroid && isChrome && !isExcluded;
  }, []);

  const isDesktopChromium = React.useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const ua = window.navigator.userAgent;
    const isDesktop = !/Android|iPhone|iPad|iPod/i.test(ua);
    const isChromium = /Chrome|Chromium|Edg/i.test(ua);
    const isExcluded = /OPR/i.test(ua);
    return isDesktop && isChromium && !isExcluded;
  }, []);

  const isStandaloneDisplay = React.useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: window-controls-overlay)").matches
      || window.matchMedia("(display-mode: fullscreen)").matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  }, []);

  const hasPersistedInstallState = React.useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage.getItem(PWA_INSTALL_STATE_KEY) === "true";
    } catch {
      return false;
    }
  }, []);

  const persistInstallState = React.useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(PWA_INSTALL_STATE_KEY, "true");
    } catch {
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined" || !shouldEnablePWAInstall()) {
      setDeferredInstallPrompt(null);
      setIsInstalled(false);
      setIsInstallCapable(false);
      return;
    }

    const updateInstallState = () => {
      const installed = isStandaloneDisplay();
      const knownInstall = installed || hasPersistedInstallState();
      setIsInstalled(installed);
      setIsInstallCapable(knownInstall || isIOS || "serviceWorker" in navigator);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
      setIsInstallCapable(true);
    };

    const handleInstalled = () => {
      persistInstallState();
      setIsInstalled(true);
      setDeferredInstallPrompt(null);
    };

    updateInstallState();
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("pageshow", updateInstallState);
    document.addEventListener("visibilitychange", updateInstallState);

    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const overlayQuery = window.matchMedia("(display-mode: window-controls-overlay)");
    const fullscreenQuery = window.matchMedia("(display-mode: fullscreen)");
    standaloneQuery.addEventListener?.("change", updateInstallState);
    overlayQuery.addEventListener?.("change", updateInstallState);
    fullscreenQuery.addEventListener?.("change", updateInstallState);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("pageshow", updateInstallState);
      document.removeEventListener("visibilitychange", updateInstallState);
      standaloneQuery.removeEventListener?.("change", updateInstallState);
      overlayQuery.removeEventListener?.("change", updateInstallState);
      fullscreenQuery.removeEventListener?.("change", updateInstallState);
    };
  }, [hasPersistedInstallState, isIOS, isStandaloneDisplay, persistInstallState]);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadRelayTip = async () => {
      if (!protectedAPIReady) {
        setRelayTips([]);
        return;
      }
      try {
        const payload = await protectedJSON<RelayTip | RelayTip[] | null>(appPath("/api/relay/tips"), { signal: controller.signal });
        if (!cancelled) {
          const nextTips = Array.isArray(payload)
            ? payload.filter((tip): tip is RelayTip => Boolean(tip?.id && tip?.title))
            : payload && payload.id && payload.title
              ? [payload]
              : [];
          setRelayTips(nextTips);
        }
      } catch {
        if (!cancelled) {
          setRelayTips([]);
        }
      }
    };

    loadRelayTip();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [protectedAPIReady]);

  const isKnownInstalled = isInstalled || hasPersistedInstallState();

  const installLabel = isKnownInstalled
    ? t("pwa.installed")
    : isIOS
      ? t("pwa.addToHomeScreen")
      : isMacSafari
        ? t("pwa.addToDock")
      : isDesktopChromium && isInstallCapable
        ? t("pwa.installApp")
      : isAndroidChrome && !deferredInstallPrompt
        ? t("pwa.installFromMenu")
      : deferredInstallPrompt
        ? t("pwa.installApp")
        : t("pwa.installInstructions");

  const installHelp = isInstalled
    ? ""
    : isKnownInstalled
      ? t("pwa.helpInstalled")
      : isIOS
      ? t("pwa.helpIOS")
      : isMacSafari
        ? t("pwa.helpMacSafari")
      : isDesktopChromium && isInstallCapable
        ? t("pwa.helpDesktopChromium")
      : isAndroidChrome && !deferredInstallPrompt
        ? t("pwa.helpAndroidChrome")
      : deferredInstallPrompt
        ? t("pwa.helpDeferred")
        : t("pwa.helpUnavailable");

  const shouldShowInstallButton = !relayNoRelayer && !isNativeApp && !isKnownInstalled && !(isAndroidChrome && !deferredInstallPrompt);
  const shouldShowInstallHelp = !relayNoRelayer && !isNativeApp && !isIOSAppRuntime() && (!!installHelp) && (isKnownInstalled || isIOS || isMacSafari || isDesktopChromium || deferredInstallPrompt !== null || (isAndroidChrome && !deferredInstallPrompt));

  const visibleRelayTips = React.useMemo(
    () => relayTips.filter((tip) => tip.id && tip.title && !dismissedRelayTipIds.includes(tip.id)),
    [dismissedRelayTipIds, relayTips],
  );

  React.useEffect(() => {
    if (visibleRelayTips.length === 0) {
      setActiveRelayTipIndex(0);
      return;
    }
    setActiveRelayTipIndex((current) => current % visibleRelayTips.length);
  }, [visibleRelayTips.length]);
  const relayTip = visibleRelayTips.length > 0
    ? visibleRelayTips[((activeRelayTipIndex % visibleRelayTips.length) + visibleRelayTips.length) % visibleRelayTips.length]
    : null;
  const shouldShowRelayTip = Boolean(relayTip);
  const shouldShowNextRelayTip = visibleRelayTips.length > 1;

  const dismissRelayTip = React.useCallback(() => {
    if (!relayTip?.id) {
      return;
    }
    setDismissedRelayTipIds((current) => {
      if (current.includes(relayTip.id)) {
        return current;
      }
      const next = [...current, relayTip.id];
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(RELAYER_AD_DISMISS_STORAGE_KEY, JSON.stringify(next));
        } catch {
        }
      }
      return next;
    });
    setActiveRelayTipIndex((current) => {
      if (visibleRelayTips.length <= 1) {
        return 0;
      }
      return current % (visibleRelayTips.length - 1);
    });
  }, [relayTip, visibleRelayTips.length]);

  const openRelayTip = React.useCallback(() => {
    if (typeof window === "undefined" || !relayTip?.href) {
      return;
    }
    if (relayTip.target === "_self") {
      window.location.assign(relayTip.href);
      return;
    }
    openExternalURL(relayTip.href);
  }, [relayTip]);

  const showNextRelayTip = React.useCallback(() => {
    if (visibleRelayTips.length <= 1) {
      return;
    }
    setActiveRelayTipIndex((current) => (current + 1) % visibleRelayTips.length);
  }, [visibleRelayTips.length]);

  const handleInstall = React.useCallback(async () => {
    if (isKnownInstalled) {
      return;
    }
    if (deferredInstallPrompt) {
      await deferredInstallPrompt.prompt();
      try {
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === "accepted") {
          persistInstallState();
          setIsInstalled(true);
        }
      } finally {
        setDeferredInstallPrompt(null);
      }
      return;
    }
    if (isIOS && typeof window !== "undefined") {
      window.alert(t("pwa.alertIOS"));
      return;
    }
    if (isMacSafari && typeof window !== "undefined") {
      window.alert(t("pwa.alertMacSafari"));
      return;
    }
    if (isDesktopChromium && typeof window !== "undefined") {
      window.alert(t("pwa.alertDesktopChromium"));
      return;
    }
    if (isAndroidChrome && typeof window !== "undefined") {
      window.alert(t("pwa.alertAndroidChrome"));
      return;
    }
    if (typeof window !== "undefined") {
      window.alert(t("pwa.alertUnavailable"));
    }
  }, [deferredInstallPrompt, isAndroidChrome, isDesktopChromium, isIOS, isKnownInstalled, isMacSafari, persistInstallState, t]);

  return {
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
  };
}
