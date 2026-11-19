import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RemoteHostShell } from "./components/remote/RemoteHostShell";
import { remoteNodePrefix } from "./services/remoteScope";
import { isRemoteWebUi } from "./services/remoteUi";
import { syncBrowserViewport } from "./services/viewport";
import { applyAppearanceMode, normalizeAppearanceMode } from "./services/appearance";
import "./services/ideaBridge";
import "./index.css";
import "./ide.css";

applyAppearanceMode(normalizeAppearanceMode(document.documentElement.getAttribute("data-theme")));
if (isRemoteWebUi) {
  syncBrowserViewport();
  window.addEventListener("resize", syncBrowserViewport);
  window.visualViewport?.addEventListener("resize", syncBrowserViewport);
  window.visualViewport?.addEventListener("scroll", syncBrowserViewport);
}
document.title = "IDEA AI Agent";
const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
createRoot(container).render(
  <I18nProvider><ErrorBoundary>
    {remoteNodePrefix() ? <RemoteHostShell><App /></RemoteHostShell> : <App />}
  </ErrorBoundary></I18nProvider>,
);
