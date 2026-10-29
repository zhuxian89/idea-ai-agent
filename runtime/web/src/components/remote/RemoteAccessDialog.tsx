import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { appPath } from "../../services/base";
import { buildPairingLink } from "../../services/pairingLink";
import { useI18n } from "../../i18n";
import "./remoteAccess.css";

type RemoteStatus = {
  relay_bound: boolean; enabled: boolean; connected: boolean;
  relay_base_url: string; node_url: string; pending_code: string;
  pairing_secret: string; last_error?: string;
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

export function RemoteAccessDialog({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const label = (cn: string, en: string) => zh ? cn : en;
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQR] = useState("");
  const [notice, setNotice] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const mutation = useRef(0);
  useEffect(() => {
    dialog.current?.showModal();
    let disposed = false;
    const refresh = async () => {
      const generation = mutation.current;
      try {
        const next = await requestRemote();
        if (!disposed && generation === mutation.current) { setStatus(next); setError(""); }
      } catch (e) { if (!disposed) setError(String(e)); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let disposed = false;
    setQR("");
    if (status?.node_url && status.pairing_secret) void QRCode.toDataURL(buildPairingLink(status.node_url, status.pairing_secret), { width: 192, margin: 2 })
      .then(value => { if (!disposed) setQR(value); })
      .catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [status?.node_url, status?.pairing_secret]);

  async function act(path: string, body: object) {
    mutation.current++;
    setBusy(true); setError(""); setNotice("");
    try { const next = await requestRemote(path, body); setStatus(next); return next; }
    catch (e) { setError(String(e)); return null; }
    finally { mutation.current++; setBusy(false); }
  }
  async function close() {
    if (status && !status.relay_bound && status.enabled) {
      if (!await act("/enable", { enabled: false })) return;
    }
    onClose();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(status!.node_url); setNotice(label("链接已复制", "Link copied")); }
    catch (e) { setError(String(e)); }
  }
  const state = !status ? label("正在读取…", "Loading…")
    : !status.relay_bound ? label("未绑定 Relay", "Relay not linked")
    : !status.enabled ? label("远程访问已关闭", "Remote access is off")
    : status.connected ? label("远程访问在线", "Remote access is online")
    : label("连接中或已断线", "Connecting or disconnected");
  const bindingURL = status?.pending_code ? `${status.relay_base_url}/bind?${new URLSearchParams({ code: status.pending_code })}` : "";
  return <dialog ref={dialog} className="remote-access-dialog" aria-labelledby="remote-title"
    onCancel={event => { event.preventDefault(); if (!busy) void close(); }}>
    <header><h2 id="remote-title">{label("远程访问", "Remote access")}</h2>
      <button type="button" onClick={() => void close()} disabled={busy} aria-label={label("关闭", "Close")}>×</button></header>
    <p role="status">{state}</p>
    {status && !status.relay_bound ? <>
      <p>{label("使用远程访问前，请先绑定 Relay。", "Link Relay before using remote access.")}</p>
      {bindingURL ? <><a href={bindingURL} target="_blank" rel="noreferrer">{label("打开 Relay 绑定页面", "Open Relay linking page")}</a>
        <p>{label("在打开的页面登录并确认绑定，完成后这里会自动更新。", "Sign in and confirm linking. This panel updates automatically.")}</p></>
        : <button type="button" disabled={busy} onClick={() => void act("/bind", {})}>{label("去绑定", "Link Relay")}</button>}
    </> : null}
    {status?.relay_bound ? <>
      <input aria-label={label("远程访问地址", "Remote URL")} readOnly value={status.node_url} onFocus={e => e.currentTarget.select()} />
      <div className="remote-actions"><a href={status.node_url} target="_blank" rel="noreferrer">{label("打开浏览器", "Open browser")}</a>
        <button type="button" onClick={() => void copy()}>{label("复制链接", "Copy link")}</button></div>
      {qr ? <img className="remote-qr" src={qr} alt={label("远程访问二维码", "Remote access QR code")} /> : null}
      <p>{label("手机扫码即可连接，无需输入配对密钥。二维码包含访问权限，请勿转发。", "Scan with your phone to connect without entering a pairing key. This QR code grants access; do not share it.")}</p>
      <p className="remote-note">{label("电脑浏览器首次打开普通链接时，输入下方配对密钥；配对后会自动记住。", "On a computer, enter the pairing key below the first time you open the regular link. The browser will remember it.")}</p>
      <button type="button" onClick={() => setShowSecret(value => !value)}>{label(showSecret ? "隐藏配对密钥" : "显示配对密钥", showSecret ? "Hide pairing key" : "Show pairing key")}</button>
      {showSecret ? <input aria-label={label("配对密钥", "Pairing key")} readOnly value={status.pairing_secret} onFocus={e => e.currentTarget.select()} /> : null}
      <div className="remote-actions"><button type="button" disabled={busy} onClick={() => void act("/enable", { enabled: !status.enabled })}>{label(status.enabled ? "关闭远程访问" : "开启远程访问", status.enabled ? "Turn off remote access" : "Turn on remote access")}</button>
        <button type="button" disabled={busy} onClick={async () => {
          if (await act("/enable", { enabled: false })) setNotice(label("远程访问已关闭。请在 Relay 节点管理页删除此节点，完成解绑。", "Remote access is off. Delete this node in Relay to unlink it."));
        }}>{label("解绑", "Unlink")}</button></div>
      <a href={`${status.relay_base_url}/nodes`} target="_blank" rel="noreferrer">{label("打开 Relay 节点管理", "Manage Relay nodes")}</a>
    </> : null}
    {status?.last_error ? <p role="alert">{status.last_error}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <p className="remote-note">{label("保持电脑联网，并让 IDEA 和当前项目保持运行。", "Keep this computer online and this IDEA project running.")}</p>
  </dialog>;
}
