import React, { useId } from "react";
import { useI18n } from "../i18n";

type Schema = { type?: string; title?: string; description?: string; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[] };
export type NativeInteraction = {
  kind: string; title: string; message: string; url?: string;
  schema?: Schema; details?: Record<string, unknown>; actions: string[];
};
export function getNativeInteraction(value: unknown): NativeInteraction | null {
  if (!value || typeof value !== "object") return null;
  const item = value as NativeInteraction;
  return typeof item.kind === "string" && Array.isArray(item.actions) ? item : null;
}

const control: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--content-bg)", color: "var(--text-primary)", font: "inherit" };

export function NativeInteractionFields({ interaction: n, answers, onChange, disabled }: {
  interaction: NativeInteraction; answers: Record<string, string>;
  onChange: (answers: Record<string, string>) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  const groupID = useId();
  const labels: Record<string, string> = {
    accept: t("native.accept"), decline: t("native.decline"), cancel: t("native.cancel"),
    allow_turn: t("native.allowTurn"), allow_session: t("native.allowSession"),
    retry_fallback: t("native.retryFallback"), edit_prompt: t("native.editPrompt"), cancelled: t("native.cancel"),
  };
  const details = n.kind === "permissions" && n.details
    ? { cwd: n.details.cwd, permissions: n.details.permissions }
    : n.kind === "refusal_fallback_prompt" && n.details
      ? { originalModel: n.details.originalModel, fallbackModel: n.details.fallbackModel }
      : n.details;
  const form = n.kind === "form" || n.kind === "openai/form";
  const properties = n.schema?.properties || {};
  const simple = n.schema?.type === "object" && Object.values(properties).every(p =>
    p && (["string", "number", "integer", "boolean"].includes(p.type || "") || Array.isArray(p.enum)) &&
    (!p.enum || p.enum.every(value => value === null || ["string", "number", "boolean"].includes(typeof value))));
  let content: Record<string, unknown> = {};
  try { const parsed = JSON.parse(answers.q_1 || "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) content = parsed; } catch { /* JSON editor preserves incomplete input. */ }
  const field = (name: string, value: unknown) => {
    const next = { ...content };
    if (value === undefined) delete next[name]; else next[name] = value;
    onChange({ ...answers, q_1: JSON.stringify(next) });
  };
  let safeURL = "";
  try { const url = new URL(n.url || ""); if (["http:", "https:"].includes(url.protocol)) safeURL = url.href; } catch { /* Invalid links remain plain text. */ }
  return <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: "12px" }}>
    {n.message && <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.message}</p>}
    {n.kind === "url" && <div style={{ overflowWrap: "anywhere" }}>
      <p style={{ margin: "0 0 6px" }}>{t("native.urlHint")}</p>
      {safeURL ? <a href={safeURL} target="_blank" rel="noopener noreferrer">{safeURL}</a> : <span>{n.url}</span>}
    </div>}
    {details && (n.kind === "refusal_fallback_prompt"
      ? <p style={{ margin: 0, overflowWrap: "anywhere" }}>{String(details.originalModel || "")} → {String(details.fallbackModel || "")}</p>
      : <details open><summary>{t("native.details")}</summary><pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "12px" }}>{JSON.stringify(details, null, 2)}</pre></details>)}
    <div role="radiogroup" aria-label={t("native.action")} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {n.actions.map(action => <label key={action} style={{ display: "flex", gap: "6px", alignItems: "center", padding: "7px 10px", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: disabled ? "default" : "pointer" }}>
        <input type="radio" name={groupID} checked={answers.q_0 === action} onChange={() => onChange({ ...answers, q_0: action, ...(form && action === "accept" && !answers.q_1 ? { q_1: "{}" } : {}) })} />
        {labels[action] || action}
      </label>)}
    </div>
    {form && answers.q_0 === "accept" && (simple ? Object.entries(properties).map(([name, schema]) => {
      const required = n.schema?.required?.includes(name);
      const label = `${schema.title || name}${required ? " *" : ""}`;
      const value = content[name];
      return <label key={name} style={{ display: "grid", gap: "5px" }}>
        <span>{label}</span>
        {schema.description && <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{schema.description}</span>}
        {schema.enum ? <select aria-label={label} style={control} value={value === undefined ? "" : String(schema.enum.findIndex(v => v === value))} onChange={e => field(name, e.target.value === "" ? undefined : schema.enum![Number(e.target.value)])}>
          <option value="">{t("native.choose")}</option>{schema.enum.map((v, i) => <option key={i} value={i}>{String(v)}</option>)}
        </select> : schema.type === "boolean" ? <select aria-label={label} style={control} value={value === undefined ? "" : String(value)} onChange={e => field(name, e.target.value === "" ? undefined : e.target.value === "true")}>
          <option value="">{t("native.choose")}</option><option value="true">{t("native.yes")}</option><option value="false">{t("native.no")}</option>
        </select> : <input aria-label={label} style={control} type={schema.type === "string" ? "text" : "number"} step={schema.type === "integer" ? 1 : "any"} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={e => field(name, schema.type === "string" ? e.target.value : e.target.value === "" ? undefined : Number(e.target.value))} />}
      </label>;
    }) : <label style={{ display: "grid", gap: "6px" }}>{t("native.jsonContent")}
      <details><summary>{t("native.schema")}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(n.schema, null, 2)}</pre></details>
      <textarea aria-label={t("native.jsonContent")} rows={8} spellCheck={false} style={{ ...control, resize: "vertical", fontFamily: "monospace" }} value={answers.q_1 || "{}"} onChange={e => onChange({ ...answers, q_1: e.target.value })} />
    </label>)}
  </fieldset>;
}
