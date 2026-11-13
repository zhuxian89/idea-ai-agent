import React, { useEffect, useState } from "react";
import { installIdeaBackend, requestBackendMode, restartIdeaForRemoteSetup, selectBackendMode } from "../../services/ideaBridge";

type Mode = "embedded" | "standalone";
type ModeState = {
  current: Mode; selected: Mode; confirmed: boolean; installed: boolean; running: boolean;
  installing: boolean; installError: string; installationError?: string; setupError?: string;
};

export function RemoteBackendChoice({ zh, onReady, onClose, showSummary, disabled }: { zh: boolean; onReady: (ready: boolean) => void; onClose: () => void; showSummary: boolean; disabled: boolean }) {
  const label = (cn: string, en: string) => zh ? cn : en;
  const [state, setState] = useState<ModeState | null>(null);
  const [draft, setDraft] = useState<Mode>("embedded");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<ModeState | { error: string }>).detail;
      setSaving(false);
      setChecking(false);
      if ("error" in detail) { setError(detail.error); return; }
      setState(detail); setError("");
    };
    window.addEventListener("idea:backend-mode", receive);
    window.addEventListener("idea:backend-state", requestBackendMode);
    requestBackendMode();
    return () => {
      window.removeEventListener("idea:backend-mode", receive);
      window.removeEventListener("idea:backend-state", requestBackendMode);
    };
  }, []);
  useEffect(() => { if (state) setDraft(state.selected); }, [state?.selected]);
  useEffect(() => { if (state?.installing) setDraft("standalone"); }, [state?.installing]);
  const applied = !!state?.confirmed && state.selected === state.current && (state.current === "embedded" || state.installed);
  const ready = applied && !editing && !saving && !checking && draft === state?.selected && !state?.installing;
  useEffect(() => { onReady(ready); }, [ready, onReady]);

  if (!state) return <section className="remote-backend-choice">
    {error ? <><p role="alert">{error}</p><button onClick={requestBackendMode}>{label("重新检测", "Check again")}</button></>
      : <p role="status">{label("正在检测服务…", "Checking services…")}</p>}
  </section>;
  const name = (mode: Mode) => mode === "embedded" ? label("内置服务", "Built-in service") : label("独立服务", "Standalone service");
  const pending = state.confirmed && state.selected !== state.current;
  const needsInstall = draft === "standalone" && !state.installed;
  const awaitingRestart = pending && state.selected === draft && !needsInstall;
  const busy = saving || checking || state.installing;
  function save() { setSaving(true); setError(""); setEditing(false); selectBackendMode(draft); }
  if (ready && !showSummary) return null;
  return <section className="remote-backend-choice">
    {ready ? <div className="remote-backend-summary"><div><p>{label("运行方式", "Run mode")}</p><p className="remote-note">{state.current === "standalone" ? label("独立后台 · 关闭 IDEA 后仍可使用", "Standalone · Available after IDEA closes") : label("内置服务 · 随 IDEA 运行", "Built-in · Runs with IDEA")}</p></div>
      <button type="button" className="remote-text-button" disabled={disabled} onClick={() => { setEditing(true); setChecking(true); requestBackendMode(); }}>{label("更改", "Change")}</button></div>
      : <>
        <fieldset disabled={busy}>
          <legend>{label("选择适合你的运行方式", "Choose how remote access runs")}</legend>
          <label className="remote-backend-option">
            <input type="radio" name="backend-mode" value="embedded" checked={draft === "embedded"} onChange={() => setDraft("embedded")} />
            <span><strong>{label("随 IDEA 运行", "Run with IDEA")}</strong><small>{label("无需安装，远程访问随 IDEA 运行。", "Ready to use. Remote access runs with IDEA.")}</small></span>
          </label>
          <label className="remote-backend-option">
            <input type="radio" name="backend-mode" value="standalone" checked={draft === "standalone"} onChange={() => { setDraft("standalone"); setChecking(true); requestBackendMode(); }} />
            <span><strong>{label("关闭 IDEA 后仍可使用", "Keep running after IDEA closes")}</strong><small>{label("统一管理项目，关闭 IDEA 后仍可远程访问。", "Manage all projects and keep remote access after IDEA closes.")}</small></span>
          </label>
          {draft === "standalone" ? <p className="remote-note" role="status">{checking ? label("正在检测独立服务…", "Checking for the standalone service…") : label(
            state.installing ? "正在下载、校验并安装独立服务，当前聊天可继续使用。" : state.installed ? (state.running ? "已检测到独立服务，正在运行。" : "已检测到独立服务，切换后会自动启动。") : "未检测到独立服务。点击下方按钮即可安装，无需操作终端。",
            state.installing ? "Downloading, verifying and installing. Current chats keep running." : state.installed ? (state.running ? "Standalone service detected and running." : "Standalone service detected. It will start when you switch.") : "Standalone service is not installed. Install it below; no terminal needed.")}</p> : null}
          {needsInstall ? <button type="button" className="remote-primary remote-wide" disabled={busy}
            onClick={() => { setSaving(true); setError(""); installIdeaBackend(); }}>
            {checking ? label("正在检测…", "Checking…") : label(busy ? "正在安装…" : "安装并继续", busy ? "Installing…" : "Install and continue")}</button>
            : awaitingRestart ? <button type="button" className="remote-primary remote-wide" disabled={busy} onClick={restartIdeaForRemoteSetup}>
              {label("重启 IDEA 并继续", "Restart IDEA and continue")}</button>
            : <button type="button" className="remote-primary remote-wide" disabled={busy || (state.confirmed && state.selected === draft)} onClick={save}>
              {saving ? label("正在保存…", "Saving…") : label(`使用${name(draft)}`, `Use ${name(draft).toLowerCase()}`)}</button>}
          {awaitingRestart ? <button type="button" className="remote-text-button" onClick={onClose}>{label("稍后重启", "Restart later")}</button> : null}
          {editing && applied ? <button type="button" className="remote-text-button" onClick={() => { setDraft(state.selected); setEditing(false); }}>{label("取消", "Cancel")}</button> : null}
        </fieldset>
        {awaitingRestart ? <p className="remote-note" role="status">{label(
          `${state.selected === "standalone" && state.installed ? "独立服务已安装。" : `已选择${name(state.selected)}。`}点击上方按钮重启 IDEA，随后自动继续设置远程访问。若还开着其他 IDEA 实例，请先退出。`,
          `${state.selected === "standalone" && state.installed ? "Standalone service is installed." : `${name(state.selected)} selected.`} Restart IDEA with the button above to continue remote setup automatically. Close any other IDEA instances first.`)}</p>
          : <p className="remote-note">{label("更改使用方式需重启全部 IDEA 生效，保存或安装不会中断当前聊天。", "Changes apply after restarting all IDEA instances. Saving or installing keeps current chats running.")}</p>}
      </>}
    {error || (!applied && state.installError) ? <p role="alert">{error || state.installError}</p> : null}
    {draft === "standalone" && state.installationError ? <p role="alert">{state.installationError}</p> : null}
    {!ready && state.setupError && !state.running ? <p role="alert">{label("远程服务设置失败：", "Remote service setup failed: ")}{state.setupError}</p> : null}
  </section>;
}
