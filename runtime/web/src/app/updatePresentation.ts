import { type MessageKey, type MessageParams } from "../i18n";
import { type UpdateState } from "../services/update";

export function normalizeUpdateState(
  input: UpdateState | null | undefined,
): UpdateState {
  return {
    current_version: input?.current_version || "",
    latest_version: input?.latest_version || "",
    has_update: input?.has_update === true,
    status: input?.status || "idle",
    message: input?.message || "",
    release_name: input?.release_name || "",
    release_body: input?.release_body || "",
    release_url: input?.release_url || "",
    published_at: input?.published_at || "",
    last_checked_at: input?.last_checked_at || "",
    auto_update_supported: input?.auto_update_supported === true,
  };
}

export function updateButtonLabel(
  state: UpdateState,
  t: (key: MessageKey, params?: MessageParams) => string,
): string {
  const status = (state.status || "idle").toLowerCase();
  switch (status) {
    case "available":
      if (state.current_version && state.latest_version) {
        return t("update.available", {
          current: state.current_version,
          latest: state.latest_version,
        });
      }
      return state.latest_version
        ? t("update.toVersion", { version: state.latest_version })
        : t("update.newVersion");
    case "downloading":
      return t("update.downloading");
    case "installing":
      return t("update.installing");
    case "restarting":
      return t("update.restarting");
    case "failed":
      return t("update.failed");
    default:
      return t("update.latest");
  }
}

export function updateSummaryText(
  state: UpdateState,
  t: (key: MessageKey, params?: MessageParams) => string,
): string {
  const body = String(state.release_body || "").trim();
  if (body) {
    return body;
  }
  const name = String(state.release_name || "").trim();
  if (name) {
    return name;
  }
  if (state.latest_version) {
    return t("update.foundVersion", { version: state.latest_version });
  }
  return "";
}

export function shouldShowUpdateButton(state: UpdateState): boolean {
  const status = (state.status || "idle").toLowerCase();
  if (
    status === "downloading" ||
    status === "installing" ||
    status === "restarting" ||
    status === "failed"
  ) {
    return true;
  }
  return state.auto_update_supported === true && state.has_update === true;
}
