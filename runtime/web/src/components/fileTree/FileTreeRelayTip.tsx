import type { useFooterState } from "./useFooterState";
import type { useFileTreeMenus } from "./useFileTreeMenus";

type Deps = {
  fileTreeMenusApi: ReturnType<typeof useFileTreeMenus>;
  footerStateApi: ReturnType<typeof useFooterState>;
};

export function FileTreeRelayTip({ fileTreeMenusApi, footerStateApi }: Deps) {
  const { t } = fileTreeMenusApi;
  const { dismissRelayTip, openRelayTip, relayTip, shouldShowNextRelayTip, shouldShowRelayTip, showNextRelayTip } = footerStateApi;
  return (
    shouldShowRelayTip && relayTip ? (
        <div
          style={{
            position: "relative",
            border:
              "1px solid color-mix(in srgb, var(--accent-color) 18%, var(--border-color))",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--sidebar-bg) 94%, var(--accent-color) 6%), color-mix(in srgb, var(--sidebar-bg) 88%, var(--accent-color) 12%))",
            boxShadow:
              "0 8px 24px color-mix(in srgb, var(--accent-color) 10%, transparent)",
            borderRadius: "8px",
            padding: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "4px", flex: 1, paddingRight: relayTip.dismissible !== false ? "14px" : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", minWidth: 0, flex: 1 }}>
                  {relayTip.badge ? (
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: "999px",
                        background:
                          "color-mix(in srgb, var(--accent-color) 14%, transparent)",
                        color: "var(--accent-color)",
                        fontSize: "10px",
                        fontWeight: 700,
                        lineHeight: 1.4,
                      }}
                    >
                      {relayTip.badge}
                    </span>
                  ) : null}
                  {relayTip.eyebrow ? (
                    <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                      {relayTip.eyebrow}
                    </span>
                  ) : null}
              </div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.35 }}>
                {relayTip.title}
              </div>
              {relayTip.description ? (
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                  {relayTip.description}
                </div>
              ) : null}
            </div>
            {relayTip.dismissible !== false ? (
              <button
                type="button"
                aria-label={t("fileTree.closeAd")}
                onClick={dismissRelayTip}
                style={{
                  position: "absolute",
                  top: "6px",
                  right: "6px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  width: "20px",
                  height: "20px",
                  borderRadius: "6px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          {(relayTip.href && relayTip.cta_label) || shouldShowNextRelayTip ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
              <div>
                {relayTip.href && relayTip.cta_label ? (
                  <button
                    type="button"
                    onClick={openRelayTip}
                    style={{
                      alignSelf: "flex-start",
                      border: "none",
                      background: "transparent",
                      color: "var(--accent-color)",
                      borderRadius: "6px",
                      padding: "0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 600,
                      lineHeight: 1,
                    }}
                  >
                    <span>{relayTip.cta_label}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14" />
                      <path d="m13 5 7 7-7 7" />
                    </svg>
                  </button>
                ) : null}
              </div>
              {shouldShowNextRelayTip ? (
                <button
                  type="button"
                  aria-label={t("fileTree.nextTip")}
                  onClick={showNextRelayTip}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--accent-color)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    cursor: "pointer",
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14" />
                    <path d="m13 5 7 7-7 7" />
                  </svg>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null
  );
}
