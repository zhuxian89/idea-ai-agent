import React, { useEffect, useState } from "react";
import { checkIdeaBackendUpdate, updateIdeaBackend } from "../../services/ideaBridge";

type UpdateState = {
  version: string; latest: string; checking: boolean; updating: boolean; available: boolean; error: string;
};

export function useBackendUpdate(checkOnOpen: boolean) {
  const [state, setState] = useState<UpdateState>({ version: "", latest: "", checking: false, updating: false, available: false, error: "" });
  useEffect(() => {
    const receive = (event: Event) => setState((event as CustomEvent<UpdateState>).detail);
    window.addEventListener("idea:standalone-update", receive);
    return () => window.removeEventListener("idea:standalone-update", receive);
  }, []);
  useEffect(() => { if (checkOnOpen) checkIdeaBackendUpdate(); }, [checkOnOpen]);
  return state;
}

export function RemoteBackendUpdate({ state, version, zh, children }: { state: UpdateState; version?: string; zh: boolean; children?: React.ReactNode }) {
  const label = (cn: string, en: string) => zh ? cn : en;
  return <section className="remote-setting-row remote-update-row" aria-label={label("独立后台更新", "Standalone updates")}>
    <div className="remote-setting-body"><p>{label("独立后台", "Standalone service")}</p>
      <p className="remote-note remote-version">{state.version || version}</p>
      {state.updating ? <p className="remote-note" role="status">{label("正在下载、校验并更新，完成后重启 IDEA…", "Downloading, verifying and updating. IDEA will restart when finished…")}</p>
        : state.latest && !state.available && !state.error ? <p className="remote-note" role="status">{label("已是最新版本", "Up to date")}</p> : null}
    </div>
    <button type="button" className="remote-text-button" disabled={state.checking || state.updating} onClick={checkIdeaBackendUpdate}>
      {state.checking ? label("检查中…", "Checking…") : label("检查更新", "Check for updates")}</button>
    {state.available && !state.updating ? <p className="remote-release">{label("有新版本 ", "New version: ")}{state.latest}</p> : null}
    {state.available && !state.updating ? <div className="remote-update-action">
      <p className="remote-note">{label("更新将重启后台和 IDEA，请先结束当前回复。", "Updating restarts the service and IDEA. Finish the current response first.")}</p>
      <button type="button" className="remote-text-button" disabled={state.checking} onClick={updateIdeaBackend}>{label("更新并重启", "Update and restart")}</button>
    </div> : null}
    {state.error ? <div className="remote-update-error"><p role="alert">{label("操作未完成，可重试。", "Could not finish. Try again.")}</p>
      <details><summary>{label("查看详情", "Details")}</summary><pre>{state.error}</pre></details></div> : null}
    {children}
  </section>;
}
