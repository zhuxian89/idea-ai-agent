import React from "react";
import { useI18n } from "../i18n";
import type { PluginSourceBundle } from "../plugins/manager";
import { ModeIcon } from "./ModeIcon";

export function PluginTrustPrompt({
  bundle,
  loading,
  onDisable,
  onAllow,
}: {
  bundle: PluginSourceBundle;
  loading: boolean;
  onDisable: () => void;
  onAllow: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--mindfs-main-bg, transparent)",
      }}
    >
      <section
        style={{
          width: "min(720px, 100%)",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          background: "var(--mindfs-panel-bg, var(--bg-primary))",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ModeIcon type="plugin" size={18} />
          <strong style={{ fontSize: 15, color: "var(--text-primary)" }}>
            {t("plugin.trustTitle")}
          </strong>
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.55,
          }}
        >
          {t("plugin.trustRisk")}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          <div>
            {t("plugin.trustRoot", {
              path: bundle.rootPath,
            })}
          </div>
          <div>
            {t("plugin.trustCount", {
              count: bundle.plugins.length,
            })}
          </div>
        </div>
        <div
          style={{
            border: "1px solid var(--border-color)",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          {bundle.plugins.map((plugin) => (
            <div
              key={plugin.path}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 12,
                padding: "8px 10px",
                borderBottom: "1px solid var(--border-color)",
                fontSize: 12,
              }}
            >
              <span
                style={{
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {plugin.path}
              </span>
              <span
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "monospace",
                }}
              >
                {plugin.sha256.slice(0, 12)}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={onDisable}
            style={{
              border: "1px solid var(--border-color)",
              background: "transparent",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer",
              color: "var(--text-secondary)",
            }}
          >
            {t("plugin.trustDisable")}
          </button>
          <button
            type="button"
            onClick={onAllow}
            style={{
              border: "1px solid var(--accent-color)",
              background: "var(--accent-color)",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer",
              color: "var(--accent-foreground, #fff)",
            }}
          >
            {loading ? t("plugin.loading") : t("plugin.trustAllow")}
          </button>
        </div>
      </section>
    </div>
  );
}
