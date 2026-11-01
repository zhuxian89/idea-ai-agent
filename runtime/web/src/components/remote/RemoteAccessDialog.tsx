import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { appPath } from "../../services/base";
import { buildPairingLink } from "../../services/pairingLink";
import { useI18n } from "../../i18n";
import "./remoteAccess.css";

type ManagedProject = { project_id: string; name: string; label: string; enabled: boolean; availability: string };
type RemoteStatus = {
  relay_bound: boolean; enabled: boolean; connected: boolean;
  relay_base_url: string; node_url: string; pending_code: string;
  pairing_secret: string; last_error?: string; node_name?: string;
  host_enabled?: boolean; host_bound?: boolean; project_id?: string; project_url?: string; project_name?: string;
  legacy_mode?: boolean; migration_pending?: boolean; projects?: ManagedProject[];
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
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQR] = useState("");
  const [notice, setNotice] = useState("");
  const [managing, setManaging] = useState(false);
  const mutation = useRef(0);
  const mutating = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || mutating.current) return;
      refreshing = true;
      const generation = mutation.current;
      try {
        const next = await requestRemote();
        if (!disposed && generation === mutation.current) { setStatus(next); setError(""); }
      } catch (e) { if (!disposed && generation === mutation.current) setError(String(e)); }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const projects = status?.projects || [];
  const currentProject = projects.find(project => project.project_id === status?.project_id);
  const hostBound = status?.host_bound ?? status?.relay_bound;
  const joined = !!status && !status.legacy_mode && status.enabled && !status.migration_pending;
  const shared = joined && currentProject?.enabled !== false;
  const ready = shared && status?.relay_bound && status.host_enabled !== false && status.connected && !error && !status.last_error;
  const pending = !!status?.migration_pending || !!status?.pending_code;
  const name = status?.project_name || projectName;
  let accessURL = "";
  if (ready && status?.pairing_secret && (status.project_url || status.node_url)) {
    const target = new URL(status.project_url || status.node_url);
    const context = new URLSearchParams(window.location.search);
    for (const key of ["root", "session"]) {
      const value = context.get(key);
      if (value) target.searchParams.set(key, value);
    }
    accessURL = buildPairingLink(target.toString(), status.pairing_secret);
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
  const failure = error || status?.last_error;
  const disconnected = joined && shared && status?.host_enabled !== false && hostBound && (!status?.connected || !!failure);
  return <dialog ref={dialog} className="remote-access-dialog remote-access-panel" aria-labelledby="remote-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id="remote-title">{label(managing ? "管理远程访问" : "远程访问", managing ? "Manage remote access" : "Remote access")}</h2>
      {ready && !managing ? <span className="remote-status"><i />{label("已开启", "Enabled")}</span> : null}
      <button className="remote-close" type="button" onClick={onClose} disabled={busy} aria-label={label("关闭", "Close")}>×</button></header>
    {!status ? <section className="remote-intro"><p role="status">{label("正在读取连接状态…", "Reading connection status…")}</p></section>
    : managing ? <section className="remote-management">
      <p className="remote-note">{label("这台电脑已开放的项目", "Projects shared by this computer")}</p>
      {projects.map(project => <label className="remote-sharing-row" key={project.project_id}>
        <span><strong>{project.name}</strong>{project.label ? <small>{project.label}</small> : null}</span>
        <input type="checkbox" role="switch" aria-label={project.name} checked={project.enabled} disabled={busy}
          onChange={event => void act("/project-sharing", { project_id: project.project_id, enabled: event.target.checked })} />
      </label>)}
      {!projects.length ? <p>{label("还没有开放的项目", "No projects are shared yet")}</p> : null}
      <p className="remote-note">{label("只有主动开放的项目，才会在远程显示。", "Only projects you choose to share appear remotely.")}</p>
      {hostBound ? <><button className="remote-wide" type="button" disabled={busy} onClick={() => void act("/host-enable", { enabled: status.host_enabled === false })}>
        {label(status.host_enabled === false ? "开启这台电脑的远程访问" : "关闭这台电脑的远程访问", status.host_enabled === false ? "Enable remote access for this computer" : "Disable remote access for this computer")}
      </button><p className="remote-note">{label("关闭后，所有远程连接断开，本地任务继续运行。", "Turning this off disconnects remote clients. Local tasks continue.")}</p></> : null}
      <button className="remote-text-button" type="button" onClick={() => setManaging(false)}>{label("返回", "Back")}</button>
    </section> : ready ? <>
      <div className="remote-computer"><span>{status.node_name || label("我的电脑", "My computer")} · {label(`${projects.filter(project => project.enabled).length} 个项目已开放`, `${projects.filter(project => project.enabled).length} projects shared`)}</span>
        <button className="remote-text-button" type="button" onClick={() => setManaging(true)}>{label("管理", "Manage")}</button></div>
      <section className="remote-scan"><h3>{label("手机扫码，继续当前项目", "Scan to continue this project")}</h3>
        {qr ? <img className="remote-qr" src={qr} alt={label("远程访问二维码", "Remote access QR code")} /> : <div className="remote-qr-placeholder" role="status">{label("正在准备连接…", "Preparing access…")}</div>}
        <p className="remote-project-name">{name}</p><p className="remote-note">{label("扫码即可进入", "Scan and start working")}</p>
      </section>
      <section className="remote-desktop"><h3>{label("在电脑浏览器中使用", "Use a computer browser")}</h3>
        <div className="remote-actions"><a className="remote-primary" href={accessURL} target="_blank" rel="noreferrer">{label("打开浏览器", "Open browser")}</a>
          <button type="button" onClick={() => void copy()}>{label("复制链接", "Copy link")}</button></div>
        <p className="remote-note">{label("链接和二维码包含访问权限，请仅供自己使用。", "The link and QR code grant access. Keep them private.")}</p>
      </section>
      <footer className="remote-panel-footer"><span>{label("保持电脑联网、IDEA 运行", "Keep your computer online and IDEA running")}</span><button className="remote-text-button" type="button" onClick={() => setManaging(true)}>{label("设置", "Settings")}</button></footer>
    </> : <section className="remote-intro">
      <h3>{label(disconnected ? "远程连接暂时中断" : pending ? "完成连接，即可开始使用" : status.host_enabled === false && hostBound ? "这台电脑的远程访问已关闭" : joined && !shared ? "当前项目已暂停远程访问" : "在手机或浏览器中继续当前项目",
        disconnected ? "Remote connection interrupted" : pending ? "Finish connecting to get started" : status.host_enabled === false && hostBound ? "Remote access is off for this computer" : joined && !shared ? "Sharing is paused for this project" : "Continue this project on your phone or browser")}</h3>
      <p className="remote-note">{label(disconnected ? "请检查网络，恢复后会自动连接。你的对话仍保留。" : pending ? "在打开的页面登录并确认，完成后这里会自动更新。" : "消息与 IDEA 实时同步，已打开的会话可以接着使用。",
        disconnected ? "Check your network. Connection resumes automatically; your conversations are kept." : pending ? "Sign in and confirm in the opened page. This panel updates automatically." : "Messages stay in sync with IDEA. Continue your existing conversations.")}</p>
      <p className="remote-project-name">{name}</p>
      {disconnected ? <button className="remote-primary remote-wide" type="button" disabled={busy} onClick={() => void act()}>{label("检查连接", "Check connection")}</button>
        : bindingURL(status) ? <a className="remote-primary remote-wide" href={bindingURL(status)} target="_blank" rel="noreferrer">{label("继续连接", "Continue connecting")}</a>
        : <button className="remote-primary remote-wide" type="button" disabled={busy} onClick={() => void enable()}>{busy ? label("正在连接…", "Connecting…") : label(pending ? "继续连接" : hostBound && status.host_enabled !== false && !joined ? "加入远程访问" : joined && !shared ? "恢复当前项目访问" : "开启远程访问", pending ? "Continue connecting" : hostBound && status.host_enabled !== false && !joined ? "Share this project" : joined && !shared ? "Resume sharing this project" : "Enable remote access")}</button>}
      {!hostBound && !pending ? <p className="remote-note">{label("首次需登录并连接访问服务", "Sign in and connect the access service once")}</p> : null}
      {hostBound ? <button className="remote-text-button remote-manage-link" type="button" onClick={() => setManaging(true)}>{label("管理远程访问", "Manage remote access")}</button> : null}
    </section>}
    {failure ? <div className="remote-connection-error"><p role="alert">{label("连接未完成，请重试。", "Could not finish connecting. Try again.")}</p><button type="button" disabled={busy} onClick={() => void act()}>{label("重试", "Retry")}</button><details><summary>{label("连接详情", "Connection details")}</summary><pre>{failure}</pre></details></div> : null}
    {notice ? <p className="remote-note" role="status">{notice}</p> : null}
  </dialog>;
}
