import React from "react";
import { useI18n } from "../i18n";
import {
  getWebPushStatus,
  sendWebPushTest,
  subscribeWebPush,
  unsubscribeWebPush,
  webPushReasonLabel,
  type WebPushStatus,
} from "../services/webPush";
import { InfoIcon, NotificationIcon } from "./FileTreeIcons";

export const fileTreeMenuButtonStyle: React.CSSProperties = {
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
};

export function WebPushMenuItem({ phone = false }: { phone?: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<WebPushStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await getWebPushStatus());
    } catch (error) {
      setStatus(null);
      setMessage(error instanceof Error ? error.message : t("fileTree.notificationStatusFailed"));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: "subscribe" | "unsubscribe" | "test") => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (action === "subscribe") {
        setStatus(await subscribeWebPush());
      } else if (action === "unsubscribe") {
        setStatus(await unsubscribeWebPush());
      } else {
        await sendWebPushTest();
        setMessage(t("fileTree.notificationSent"));
        await refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("fileTree.notificationActionFailed"));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const disabledReason = webPushReasonLabel(status?.reason);
  const enabled = Boolean(status?.enabled && status.supported);
  const subscribed = Boolean(status?.subscribed);
  const label = subscribed ? t("fileTree.notificationEnabled") : t("fileTree.enableNotification");
  const subscriptionCount = status?.subscription_count || 0;
  const currentDeviceDetail = subscribed && subscriptionCount > 0
    ? t("fileTree.notificationSubscribedDevices", { count: subscriptionCount })
    : subscribed
      ? t("fileTree.notificationDetailSubscribed")
      : t("fileTree.notificationDetailIOS");
  const detail = message || disabledReason || currentDeviceDetail;
  if (phone) return <div className="phone-more-notification">
    <button type="button" role="switch" aria-checked={subscribed} disabled={busy || !enabled} onClick={() => void run(subscribed ? "unsubscribe" : "subscribe")}>
      <NotificationIcon /><span>{busy ? t("fileTree.notificationBusy") : label}</span><i className="remote-switch" />
    </button>
    <p role="status">{detail}</p>
    <button type="button" disabled={busy || !subscribed} onClick={() => void run("test")}>{t("fileTree.sendTestNotification")}</button>
  </div>;

  return (
    <div>
      <div
        style={{
          ...fileTreeMenuButtonStyle,
          color: subscribed ? "var(--accent-color)" : "var(--text-primary)",
          opacity: busy || !enabled ? 0.55 : 1,
          cursor: "default",
          minWidth: 0,
          whiteSpace: "nowrap",
        }}
      >
        <button
          type="button"
          disabled={busy || !enabled}
          onClick={() => void run(subscribed ? "unsubscribe" : "subscribe")}
          style={{
            minWidth: 0,
            border: "none",
            background: "transparent",
            color: "inherit",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            flex: "0 1 auto",
            cursor: busy || !enabled ? "not-allowed" : "pointer",
            font: "inherit",
            textAlign: "left",
            whiteSpace: "nowrap",
          }}
        >
          <NotificationIcon />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{busy ? t("fileTree.notificationBusy") : label}</span>
        </button>
        <button
          type="button"
          aria-label={t("fileTree.notificationInfo")}
          title={t("fileTree.notificationInfo")}
          onClick={() => setExpanded((value) => !value)}
          style={{
            border: "none",
            background: "transparent",
            color: expanded ? "var(--accent-color)" : "var(--text-secondary)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            padding: 0,
            marginLeft: "-4px",
          }}
        >
          <InfoIcon />
        </button>
        <span style={{ marginLeft: "auto", fontSize: "11px", opacity: subscribed ? 1 : 0, flexShrink: 0 }}>✓</span>
      </div>
      {expanded ? (
        <>
          <div style={{ padding: "0 10px 6px 32px", color: "var(--text-secondary)", fontSize: "11px", lineHeight: 1.35 }}>
            {detail}
          </div>
          {subscribed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("test")}
              style={{
                ...fileTreeMenuButtonStyle,
                paddingLeft: "32px",
                color: "var(--text-secondary)",
                opacity: busy ? 0.55 : 1,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              <span>{t("fileTree.sendTestNotification")}</span>
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
