import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { appPath } from "../../services/base";
import { useI18n } from "../../i18n";
import { requestIdeaRemoteHost, isStandaloneRuntime, isIdeaRuntime, manageIdeaBackend } from "../../services/ideaBridge";
import "./remoteAccess.css";
import { RemoteBackendChoice } from "./RemoteBackendChoice";
import { RemoteBrowserUpdate, useBrowserUpdate } from "./RemoteBrowserUpdate";
import { RemoteBackendUpdate, useBackendUpdate } from "./RemoteBackendUpdate";

type ManagedProject = { project_id: string; name: string; label: string; enabled: boolean; availability: string };
type RemoteStatus = {
  relay_bound: boolean; enabled: boolean; connected: boolean;
  relay_base_url: string; node_url: string; pending_code: string;
  last_error?: string; node_name?: string;
  host_enabled?: boolean; host_bound?: boolean; host_reachable?: boolean; project_id?: string; project_url?: string; project_name?: string;
  legacy_mode?: boolean; migration_pending?: boolean; projects?: ManagedProject[];
  service?: { platform?: string; version?: string; address?: string; pid?: number; running?: boolean };
};

async function requestRemote(path = "", body?: object): Promise<RemoteStatus> {
  const response = await fetch(appPath(`/api/idea/remote${path}`), {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function RemoteAccessDialog({ onClose, projectName = "" }: { onClose: () => void; projectName?: string }) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const label = (cn: string, en: string) => zh ? cn : en;
  const dialog = useRef<HTMLDialogElement>(null);
  const [backendReady, setBackendReady] = useState(!isIdeaRuntime);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQR] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"access" | "settings" | "projects">("access");
  const update = useBackendUpdate(backendReady && isIdeaRuntime && isStandaloneRuntime);
  const browserUpdate = useBrowserUpdate(
    backendReady && isStandaloneRuntime && !isIdeaRuntime ? status?.service?.version : undefined,
    status?.service?.platform,
  );
  const newVersion = isStandaloneRuntime && (isIdeaRuntime ? update.available : browserUpdate.available && !browserUpdate.error);
  const latestVersion = isIdeaRuntime ? update.latest : browserUpdate.latest;
  const locked = busy || update.updating;
  const openedAt = useRef(Date.now());
  const mutation = useRef(0);
  const mutating = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!backendReady) return;
    openedAt.current = Date.now();
    if (isIdeaRuntime) requestIdeaRemoteHost();
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || mutating.current) return;
      refreshing = true;
      const generation = mutation.current;
      try {
        const next = await requestRemote();
        if (!disposed && generation === mutation.current) {
          setStatus(next);
          if (next.service?.running !== false) setError("");
        }
      } catch (e) { if (!disposed && generation === mutation.current) setError(String(e)); }
      finally { refreshing = false; }
    };
    void refresh();
    const backendState = (event: Event) => {
      const detail = (event as CustomEvent<{busy: boolean; error?: string}>).detail;
      mutating.current = detail.busy;
      setBusy(detail.busy);
      if (detail.error) setError(detail.error);
      else if (!detail.busy) void refresh();
    };
    window.addEventListener("idea:backend-state", backendState);
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("idea:backend-state", backendState); };
  }, [backendReady]);

  const projects = status?.projects || [];
  const currentProject = projects.find(project => project.project_id === status?.project_id);
  const hostBound = status?.host_bound ?? status?.relay_bound;
  const joined = !!status && !status.legacy_mode && status.enabled && !status.migration_pending;
  const shared = joined && currentProject?.enabled !== false;
  const serviceUnavailable = isStandaloneRuntime && status?.service?.running === false;
  const ready = !serviceUnavailable && shared && status?.relay_bound && status.host_enabled !== false && status.connected && !error && !status.last_error;
  const pending = !!status?.migration_pending || !!status?.pending_code;
  const name = status?.project_name || projectName;
  let accessURL = "";
  if (ready && (status?.project_url || status?.node_url)) {
    const target = new URL(status.project_url || status.node_url);
    const context = new URLSearchParams(window.location.search);
    for (const key of ["root", "session"]) {
      const value = context.get(key);
      if (value) target.searchParams.set(key, value);
    }
    accessURL = target.toString();
  }
  useEffect(() => {
    let disposed = false;
    setQR("");
    if (accessURL) void QRCode.toDataURL(accessURL, { width: 192, margin: 2 })
      .then(value => { if (!disposed) setQR(value); })
      .catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [accessURL]);

  async function act(path = "", body?: object) {
    mutation.current++;
    mutating.current = true;
    setBusy(true); setError(""); setNotice("");
    try { const next = await requestRemote(path, body); setStatus(next); return next; }
    catch (e) { setError(String(e)); return null; }
    finally { mutation.current++; mutating.current = false; setBusy(false); }
  }
  const bindingURL = (value: RemoteStatus | null) => value?.pending_code
    ? `${value.relay_base_url}/bind?${new URLSearchParams({ code: value.pending_code })}` : "";
  async function enable() {
    let next = status;
    if (isStandaloneRuntime && hostBound && status?.host_enabled === false) {
      await act("/enable", { enabled: true });
      return;
    }
    if (hostBound && status?.host_enabled === false) {
      next = await act("/host-enable", { enabled: true });
      if (!next) return;
    }
    if (!joined || !hostBound) next = await act("/bind", {});
    else if (!shared && status?.project_id) next = await act("/project-sharing", { project_id: status.project_id, enabled: true });
    const link = bindingURL(next);
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  }
  async function copy() {
    try { await navigator.clipboard.writeText(accessURL); setNotice(label("链接已复制，可在自己的其他设备上打开", "Link copied. Open it on your other device.")); }
    catch (e) { setError(String(e)); }
  }
  // The shared entry starts when this panel opens; do not report its first seconds as a failed connection.
  const hostStarting = !!status && status.host_reachable === false && Date.now() - openedAt.current < 10000;
  const failure = hostStarting ? "" : error || status?.last_error;
  const disconnected = joined && shared && status?.host_enabled !== false && hostBound && (!status?.connected || !!failure);
  const settings = backendReady && view === "settings";
  const projectList = backendReady && view === "projects";
  const details = failure ? <details className="remote-details"><summary>{label(serviceUnavailable ? "启动详情" : "连接详情", serviceUnavailable ? "Startup details" : "Connection details")}</summary><pre>{failure}</pre></details> : null;
  const serviceControls = isStandaloneRuntime && isIdeaRuntime ? <div className="remote-actions">
    {serviceUnavailable ? <button type="button" className="remote-primary remote-wide" disabled={locked} onClick={() => manageIdeaBackend("start")}>{label(busy ? "正在启动…" : failure ? "重新启动" : "启动服务", busy ? "Starting…" : failure ? "Restart service" : "Start service")}</button>
      : <><button type="button" disabled={locked || !status?.service} onClick={() => manageIdeaBackend("restart")}>{label("重启服务", "Restart service")}</button>
        <button type="button" disabled={locked || !status?.service} onClick={() => manageIdeaBackend("stop")}>{label("停止服务", "Stop service")}</button></>}
  </div> : null;
  return <dialog ref={dialog} className="remote-access-dialog remote-access-panel" aria-labelledby="remote-title"
    onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
    <header>{settings || projectList ? <button type="button" className="remote-icon-button" aria-label={label("返回", "Back")} disabled={locked} onClick={() => setView(projectList ? "settings" : "access")}><RemoteIcon name="back" /></button> : null}
      <h2 id="remote-title">{settings ? label("设置", "Settings") : projectList ? label("已加入的项目", "Shared projects") : label("远程访问", "Remote access")}</h2>
      {backendReady && ready && view === "access" ? <span className="remote-status"><i />{label("已连接", "Connected")}</span> : null}
      <button className="remote-close remote-icon-button" type="button" onClick={onClose} disabled={locked} aria-label={label("关闭", "Close")}><RemoteIcon name="close" /></button>
    </header>
    {isIdeaRuntime ? <RemoteBackendChoice zh={zh} onReady={setBackendReady} onClose={onClose} showSummary={settings} disabled={locked} /> : null}
    {!backendReady ? null : settings ? <>
      {isStandaloneRuntime && isIdeaRuntime ? <RemoteBackendUpdate state={update} version={status?.service?.version} zh={zh}>
        <div className="remote-service-management">
          {status?.service ? <p className="remote-note">{label(serviceUnavailable ? "远程服务未启动" : "远程服务运行中", serviceUnavailable ? "Remote service is not running" : "Remote service is running")}</p> : null}
          {serviceControls}
          <p className="remote-note">{label("重启或停止服务会断开远程设备，本地聊天可继续使用。", "Restarting or stopping disconnects remote devices. Local chats remain available.")}</p>
        </div>
      </RemoteBackendUpdate> : isStandaloneRuntime && status?.service?.version && status.service.platform ? <RemoteBrowserUpdate state={browserUpdate} version={status.service.version} zh={zh} /> : null}
      <button className="remote-row-link" type="button" disabled={locked} onClick={() => setView("projects")}><span>{label("已加入的项目", "Shared projects")}</span><span>{projects.length}<RemoteIcon name="right" /></span></button>
      <details className="remote-support"><summary>{label("故障排查", "Troubleshooting")}</summary>
        <p className="remote-note">{serviceUnavailable ? label("远程服务未启动", "Remote service is not running") : ready ? label("服务运行正常 · 远程已连接", "Service running · Remote connected") : label("远程尚未连接", "Remote is not connected")}</p>
        {status?.service ? <p className="remote-note remote-service-status">{status.service.address}</p> : null}
        {details}
      </details>
      {hostBound && !serviceUnavailable ? <div className="remote-setting-footer"><button className="remote-text-button" type="button" disabled={locked} onClick={async () => {
        const next = await act(isStandaloneRuntime ? "/enable" : "/host-enable", { enabled: status?.host_enabled === false });
        if (next) setView("access");
      }}>{status?.host_enabled === false ? label("开启远程访问", "Enable remote access") : label("暂停远程访问", "Pause remote access")}</button></div> : null}
    </> : projectList ? <section className="remote-management">
      <p className="remote-note">{label("这些项目通过同一个远程入口访问。", "Access these projects through one remote entry.")}</p>
      {projects.map(project => <label className="remote-sharing-row" key={project.project_id}>
        <span><strong>{project.name}</strong>{project.label ? <small>{project.label}</small> : null}</span>
        {!isStandaloneRuntime ? <input type="checkbox" role="switch" aria-label={project.name} checked={project.enabled} disabled={locked}
          onChange={event => void act("/project-sharing", { project_id: project.project_id, enabled: event.target.checked })} /> : null}
      </label>)}
      {!projects.length ? <p className="remote-note">{label("还没有加入的项目", "No projects have been added yet")}</p> : null}
      {failure ? <><p role="alert">{label("操作未完成", "Could not finish the action")}</p>{details}</> : null}
    </section> : !status ? <section className="remote-intro">
      {error ? <><h3>{label("无法读取连接状态", "Could not read connection status")}</h3><button type="button" className="remote-primary remote-wide" disabled={locked} onClick={() => void act()}>{label("重试", "Retry")}</button>{details}</> : <p role="status">{label("正在读取连接状态…", "Reading connection status…")}</p>}
    </section> : serviceUnavailable ? <section className="remote-intro">
      <div className="remote-message-icon"><RemoteIcon name="power" /></div>
      <h3>{label(busy ? "正在启动远程服务…" : failure ? "远程服务启动失败" : "远程服务未启动", busy ? "Starting remote service…" : failure ? "Remote service failed to start" : "Remote service is not running")}</h3>
      <p className="remote-note">{label("本地聊天可以继续使用。启动服务后再设置远程访问。", "Local chats remain available. Start the service to set up remote access.")}</p>
      {serviceControls}{details}
    </section> : ready ? <>
      <section className="remote-scan"><p className="remote-project-name"><RemoteIcon name="folder" />{name || status.node_name || label("我的电脑", "My computer")}</p>
        <p className="remote-note">{label("进入当前项目，也可切换其他项目", "Open this project or switch to another")}</p>
        {qr ? <img className="remote-qr" src={qr} alt={label("远程访问二维码", "Remote access QR code")} /> : <div className="remote-qr-placeholder" role="status">{label("正在准备连接…", "Preparing access…")}</div>}
        <p className="remote-note">{label("用手机扫一扫，继续当前会话", "Scan to continue your conversation")}</p>
      </section>
      <div className="remote-actions"><a className="remote-primary" href={accessURL} target="_blank" rel="noreferrer"><RemoteIcon name="external" />{label("打开网页", "Open browser")}</a>
        <button type="button" onClick={() => void copy()}><RemoteIcon name="copy" />{label("复制链接", "Copy link")}</button></div>
    </> : <section className="remote-intro">
      <div className="remote-message-icon"><RemoteIcon name="globe" /></div>
      <h3>{label(disconnected ? "远程连接暂时中断" : pending ? "在浏览器中完成登录" : status.host_enabled === false && hostBound ? "远程访问已暂停" : joined && !shared ? "当前项目已暂停远程访问" : "在其他设备继续使用",
        disconnected ? "Remote connection interrupted" : pending ? "Sign in with your browser" : status.host_enabled === false && hostBound ? "Remote access is paused" : joined && !shared ? "Sharing is paused for this project" : "Continue on your other devices")}</h3>
      <p className="remote-note">{label(disconnected ? "请检查电脑的网络，恢复后会自动连接。" : pending ? "在打开的页面登录并确认，完成后这里会自动显示访问入口。" : "消息在各设备间实时同步，可以继续已有会话。",
        disconnected ? "Check this computer’s network. It will reconnect automatically." : pending ? "Sign in and confirm in the opened page. Access links will appear here automatically." : "Messages stay in sync across devices. Continue your existing conversations.")}</p>
      {disconnected ? <button className="remote-primary remote-wide" type="button" disabled={locked} onClick={() => void act()}>{label("检查连接", "Check connection")}</button>
        : bindingURL(status) ? <a className="remote-primary remote-wide" href={bindingURL(status)} target="_blank" rel="noreferrer">{label("继续登录", "Continue signing in")}</a>
        : <button className="remote-primary remote-wide" type="button" disabled={locked || hostStarting} onClick={() => void enable()}>{busy ? label("正在连接…", "Connecting…") : label(pending ? "继续登录" : hostBound && status.host_enabled !== false && !joined ? "加入远程访问" : joined && !shared ? "恢复当前项目访问" : "开启远程访问", pending ? "Continue signing in" : hostBound && status.host_enabled !== false && !joined ? "Share this project" : joined && !shared ? "Resume sharing this project" : "Enable remote access")}</button>}
      {details}
    </section>}
    {backendReady && view === "access" ? <footer className="remote-panel-footer"><span>{ready ? isStandaloneRuntime ? label("电脑联网时，关闭 IDEA 仍可访问", "Available after IDEA closes while this computer is online") : label("关闭 IDEA 后，远程访问会停止", "Remote access stops when IDEA closes") : label("本地聊天可继续使用", "Local chats remain available")}</span>
      <div className="remote-footer-actions">
        {newVersion ? <button className="remote-text-button remote-update-notice" type="button" disabled={locked} aria-label={label("有新版本", "Update available")}
          title={label(`独立后台 ${latestVersion}，前往设置升级`, `Standalone service ${latestVersion}. Open settings to update`)} onClick={() => setView("settings")}>
          <span role="status"><i aria-hidden="true" />{label("有新版本", "Update available")}</span>
        </button> : null}
        <button className="remote-text-button" type="button" disabled={locked} onClick={() => setView("settings")}><RemoteIcon name="settings" />{label("设置", "Settings")}</button>
      </div>
    </footer> : null}
    {notice ? <p className="remote-note" role="status">{notice}</p> : null}
  </dialog>;
}

function RemoteIcon({ name }: { name: "back" | "close" | "right" | "power" | "folder" | "globe" | "external" | "copy" | "settings" }) {
  const paths = {
    back: "m14 6-6 6 6 6", close: "m6 6 12 12M6 18 18 6", right: "m9 6 6 6-6 6",
    power: "M12 2v9M6 5a9 9 0 1 0 12 0", folder: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
    globe: "M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18",
    external: "M14 4h6v6M20 4l-9 9M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
    copy: "M8 8h12v12H8ZM16 8V4H4v12h4",
    settings: "m9 4 1-2h4l1 2 2 1 2 0 2 3-1 2v4l1 2-2 3-2 0-2 1-1 2h-4l-1-2-2-1-2 0-2-3 1-2v-4L3 8l2-3 2 0ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  };
  return <svg className="remote-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
