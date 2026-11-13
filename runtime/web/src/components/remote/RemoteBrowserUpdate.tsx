import React, { useEffect, useState } from "react";
import { checkStandaloneRelease, compareStandaloneVersions } from "../../services/standaloneRelease";

export function useBrowserUpdate(version?: string, platform?: string) {
  const [latest, setLatest] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!version || !platform) return;
    const controller = new AbortController();
    let active = true;
    setChecking(true); setError("");
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    checkStandaloneRelease(platform, controller.signal).then(value => {
      if (active) { setAvailable(compareStandaloneVersions(version, value) < 0); setLatest(value); }
    }).catch(cause => { if (active) setError(String(cause)); })
      .finally(() => { window.clearTimeout(timeout); if (active) setChecking(false); });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [attempt, platform, version]);
  return { latest, checking, error, available, check: () => setAttempt(value => value + 1) };
}

/** The browser can inspect releases; installation is owned by the local IDEA installer. */
export function RemoteBrowserUpdate({ state, version, zh }: { state: ReturnType<typeof useBrowserUpdate>; version: string; zh: boolean }) {
  const label = (cn: string, en: string) => zh ? cn : en;
  const { latest, checking, error, available, check } = state;
  return <section className="remote-setting-row remote-update-row" aria-label={label("独立后台更新", "Standalone updates")}>
    <div className="remote-setting-body"><p>{label("独立后台", "Standalone service")}</p><p className="remote-note remote-version">{version}</p>
      {latest && !error ? <p className={available ? "remote-release" : "remote-note"} role="status">{available ? label(`有新版本 ${latest}`, `New version: ${latest}`) : label("已是最新版本", "Up to date")}</p> : null}
    </div>
    <button type="button" className="remote-text-button" disabled={checking} onClick={check}>{checking ? label("检查中…", "Checking…") : label("检查更新", "Check for updates")}</button>
    {available && !error ? <div className="remote-update-action"><p className="remote-note">{label("在 IDEA 的远程设置中点击更新，即可自动安装。", "Update from IDEA’s remote settings for automatic installation.")}</p>
      <a href={`https://github.com/zhuxian89/idea-ai-agent/releases/tag/standalone-v${latest}`} target="_blank" rel="noreferrer">{label("查看新版", "View release")}</a></div> : null}
    {error ? <div className="remote-update-error"><p role="alert">{label("无法检查更新，请重试。", "Could not check for updates. Try again.")}</p><details><summary>{label("查看详情", "Details")}</summary><pre>{error}</pre></details></div> : null}
  </section>;
}
