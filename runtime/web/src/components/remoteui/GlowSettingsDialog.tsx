import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import {
  GLOW_DEFAULT,
  GLOW_EFFECTS,
  GLOW_PALETTE,
  GLOW_SPEEDS,
  loadGlowConfig,
  saveGlowConfig,
  type GlowColor,
  type GlowConfig,
} from "../../services/remoteGlow";

export function GlowSettingsDialog({ open, onClose, title }: { open: boolean; onClose: () => void; title?: string }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<GlowConfig>(() => loadGlowConfig());
  const doneRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfig(loadGlowConfig());
    doneRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const update = (patch: Partial<GlowConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveGlowConfig(next);
  };
  const colorLabel = (color: GlowColor) => t(`glow.color.${color}` as const);
  const dialogTitle = title ?? t("glow.title");

  return createPortal(
    <div className="remote-glow-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="remote-glow-dialog" role="dialog" aria-modal="true" aria-label={dialogTitle}>
        <header>
          <h2>{dialogTitle}</h2>
          <button type="button" className="remote-glow-close" aria-label={t("common.close")} onClick={onClose}>×</button>
        </header>
        <div className="remote-glow-body">
          <div className="remote-glow-demo remote-glow-frame" aria-hidden="true"><span>{t("glow.preview")}</span></div>
          <button type="button" role="switch" aria-checked={config.on} className="remote-glow-row" onClick={() => update({ on: !config.on })}>
            <span className="remote-glow-row-text">
              <b>{t("glow.on")}</b>
              <small>{t("glow.onHint")}</small>
            </span>
            <span className="remote-switch" aria-hidden="true" />
          </button>

          <div className="remote-glow-label">{t("glow.effect")}</div>
          <div className="remote-glow-seg" role="group" aria-label={t("glow.effect")}>
            {GLOW_EFFECTS.map((fx) => (
              <button key={fx} type="button" aria-pressed={config.fx === fx} onClick={() => update({ fx })}>{t(`glow.fx.${fx}` as const)}</button>
            ))}
          </div>

          <div className="remote-glow-label">{t("glow.color")}<span>{colorLabel(config.color)}</span></div>
          <div className="remote-glow-colors" role="group" aria-label={t("glow.color")}>
            <button type="button" className="theme" aria-pressed={config.color === "theme"} aria-label={t("glow.color.theme")} title={t("glow.color.theme")} onClick={() => update({ color: "theme" })}>{t("glow.color.themeShort")}</button>
            {GLOW_PALETTE.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={config.color === item.id}
                aria-label={colorLabel(item.id)}
                title={colorLabel(item.id)}
                style={{ background: `linear-gradient(135deg, ${item.stops[0]}, ${item.stops[1]}, ${item.stops[2]})` }}
                onClick={() => update({ color: item.id })}
              />
            ))}
            <label className="custom" data-active={config.color === "custom"} title={t("glow.color.custom")}>
              <input type="color" value={config.custom} aria-label={t("glow.color.custom")} onChange={(event) => update({ color: "custom", custom: event.target.value })} />
            </label>
          </div>

          <div className="remote-glow-label">{t("glow.speed")}</div>
          <div className="remote-glow-seg" role="group" aria-label={t("glow.speed")}>
            {GLOW_SPEEDS.map((speed) => (
              <button key={speed} type="button" aria-pressed={config.speed === speed} onClick={() => update({ speed })}>{t(`glow.speed.${speed}` as const)}</button>
            ))}
          </div>
        </div>
        <footer>
          <button type="button" onClick={() => { setConfig({ ...GLOW_DEFAULT }); saveGlowConfig({ ...GLOW_DEFAULT }); }}>{t("glow.reset")}</button>
          <button type="button" className="primary" ref={doneRef} onClick={onClose}>{t("glow.done")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
