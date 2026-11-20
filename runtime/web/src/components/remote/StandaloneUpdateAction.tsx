import React, { useEffect, useReducer, useRef, useState } from "react";
import { bootstrapService } from "../../services/bootstrap";
import {
  POLL_MS,
  RELOAD_AFTER_MS,
  fetchUpdateStatus,
  initialUpdateUi,
  nextUpdateUi,
  startUpdate,
  type UpdateUi,
} from "../../services/standaloneUpdate";

/** 读取并轮询更新状态。刷新页面后仍能看到正在进行的更新；完成后刷新页面加载新版网页。 */
export function useStandaloneUpdate(pageVersion: string) {
  const [ui, dispatch] = useReducer(nextUpdateUi, initialUpdateUi);
  useEffect(() => {
    let alive = true;
    let checked = false;
    const unsubscribe = bootstrapService.subscribe(({ phase }) => {
      if (phase !== "ready" || checked) return;
      checked = true;
      fetchUpdateStatus()
        .then((status) => { if (alive) dispatch({ type: "status", status, pageVersion }); })
        .catch(() => { if (alive) dispatch({ type: "unsupported" }); });
    });
    return () => { alive = false; unsubscribe(); };
  }, [pageVersion]);
  const polling = ui.step === "installing" || ui.step === "reconnecting";
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    const tick = () => fetchUpdateStatus()
      .then((status) => { if (alive) dispatch({ type: "status", status, pageVersion }); })
      .catch(() => { if (alive) dispatch({ type: "unreachable", at: Date.now() }); });
    const timer = window.setInterval(tick, POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [polling, pageVersion]);
  useEffect(() => {
    if (ui.step !== "done") return;
    const timer = window.setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [ui.step]);
  const start = (version: string) => startUpdate(version)
    .then((status) => dispatch({ type: "status", status, pageVersion }))
    .catch((cause) => dispatch({ type: "startFailed", error: cause instanceof Error ? cause.message : String(cause) }));
  return { ui, start, dismiss: () => dispatch({ type: "dismiss" }) };
}

type Props = {
  ui: UpdateUi;
  latest: string;
  /** 页面上已经显示的新版本，用来触发更新 */
  available: boolean;
  zh: boolean;
  onStart: (version: string) => void;
  onDismiss: () => void;
  releaseURL: string;
};

/** 有新版本时的“立即更新”，以及更新中、完成、失败的状态。设计稿见 docs/design/standalone-update-v1。 */
export function StandaloneUpdateAction({ ui, latest, available, zh, onStart, onDismiss, releaseURL }: Props) {
  const label = (cn: string, en: string) => (zh ? cn : en);
  const dialog = useRef<HTMLDialogElement>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) element.showModal();
    if (!asking && element.open) element.close();
  }, [asking]);

  if (ui.step === "installing" || ui.step === "reconnecting") {
    const text = ui.step === "installing"
      ? label(`正在更新到 ${ui.target || latest}…`, `Updating to ${ui.target || latest}…`)
      : label("后台正在重启，页面会自动重新连接…", "The backend is restarting; this page reconnects by itself…");
    return (
      <div className="remote-update-progress" role="status" aria-live="polite">
        <div className="remote-update-state"><span className="remote-update-spin" aria-hidden="true" /><span>{text}</span></div>
        <div className="remote-update-bar" aria-hidden="true"><i /></div>
      </div>
    );
  }
  if (ui.step === "done") {
    return (
      <div className="remote-update-progress" role="status" aria-live="polite">
        <div className="remote-update-state remote-update-ok">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
          <span>{label(`已更新到 ${ui.target}，聊天记录已保留。`, `Updated to ${ui.target}. Your chats are kept.`)}</span>
        </div>
      </div>
    );
  }
  const failed = ui.step === "failed";
  const reconnectLost = failed && ui.error === "reconnect_timeout";
  return (
    <div className="remote-update-controls">
      {failed ? (
        <div className="remote-update-failure" role="alert">
          <b>{reconnectLost
            ? label("更新后一直连不上这台电脑。", "Could not reconnect after the update.")
            : label("更新没有完成。", "The update did not finish.")}</b>
          {reconnectLost
            ? <p>{label("请在那台电脑上确认 Local AI Agent 是否在运行。", "Check that Local AI Agent is running on that computer.")}</p>
            : (ui.error || ui.log) ? (
              <details><summary>{label("查看详情", "Details")}</summary><pre>{[ui.error, ui.log].filter(Boolean).join("\n\n")}</pre></details>
            ) : null}
        </div>
      ) : null}
      {available || failed ? (
        <div className="remote-update-buttons">
          <button type="button" className="remote-update-primary" onClick={() => { onDismiss(); setAsking(true); }}>
            {failed ? label("重试", "Retry") : label("立即更新", "Update now")}
          </button>
          <a className="remote-update-secondary" href={releaseURL} target="_blank" rel="noreferrer">{label("查看新版", "View release")}</a>
        </div>
      ) : null}
      {!failed && available ? (
        <p className="remote-update-small">{label("更新会重启后台，进行中的会话会中断，聊天记录保留。", "Updating restarts the backend. Running sessions are interrupted; chats are kept.")}</p>
      ) : null}
      <dialog ref={dialog} className="remote-update-dialog" aria-labelledby="remote-update-title" onClose={() => setAsking(false)} onCancel={() => setAsking(false)}>
        <h3 id="remote-update-title">{label(`更新到 ${latest}？`, `Update to ${latest}?`)}</h3>
        <p>{label("更新会重启这台电脑上的后台：", "Updating restarts the backend on this computer:")}</p>
        <ul>
          <li>{label("正在运行的会话会中断", "Running sessions are interrupted")}</li>
          <li>{label("聊天记录、端口和远程绑定保留", "Chats, the port and the remote binding are kept")}</li>
          <li>{label("安装失败时会尝试恢复后台", "The installer attempts to restore the service if installation fails")}</li>
        </ul>
        <p className="remote-update-small">{label("更新期间这个页面会断开，恢复后自动重新连接。", "This page disconnects during the update and reconnects afterwards.")}</p>
        <div className="remote-update-dialog-actions">
          <button type="button" className="remote-update-secondary" onClick={() => setAsking(false)}>{label("取消", "Cancel")}</button>
          <button type="button" className="remote-update-primary" onClick={() => { setAsking(false); onStart(latest); }}>{label("更新并重启", "Update and restart")}</button>
        </div>
      </dialog>
    </div>
  );
}
