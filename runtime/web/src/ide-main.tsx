import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyAppearanceMode } from "./services/appearance";
import "./services/ideaBridge";
import "./index.css";

applyAppearanceMode();
document.title = "IDEA AI Agent";
const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
createRoot(container).render(
  <I18nProvider><ErrorBoundary><App /></ErrorBoundary></I18nProvider>,
);
