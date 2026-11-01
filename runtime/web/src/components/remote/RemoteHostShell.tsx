import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { hostPath } from "../../services/base";
import { remoteNodePrefix, remoteProjectId } from "../../services/remoteScope";
import { e2eeService } from "../../services/e2ee";
import {
  listRemoteProjects, navigateRemoteProject, openRemoteProject, readRemoteHostStatus,
  remoteHostE2EE, type RemoteProject,
} from "../../services/remoteHost";
import { RemoteAccessRequired } from "./RemoteAccessRequired";
import "./remoteAccess.css";

type Phase = "loading" | "legacy" | "pairing" | "catalog" | "project" | "error";

export function RemoteHostShell({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const text = (cn: string, en: string) => zh ? cn : en;
  const [phase, setPhase] = useState<Phase>("loading");
  const [hostName, setHostName] = useState("");
  const [projects, setProjects] = useState<RemoteProject[]>([]);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const currentProject = remoteProjectId();
  const started = useRef(false);
  const generation = useRef(0);
  const refreshing = useRef(false);
  const menu = useRef<HTMLDialogElement>(null);

  const connect = useCallback(async () => {
    const attempt = ++generation.current;
    setBusy(true); setError(""); setMenuOpen(false); setPhase("loading");
    try {
      const status = await readRemoteHostStatus();
      if (attempt !== generation.current) return;
      if (!status.remote_host) { setPhase("legacy"); return; }
      setHostName(status.node_name || "");
      if (!remoteHostE2EE.hasSecret()) { setPhase("pairing"); return; }
      await remoteHostE2EE.ensureSession();
      const privateStatus = await remoteHostE2EE.protectedJSON<{node_name?: string}>(hostPath("/api/relay/status"));
      if (attempt !== generation.current) return;
      if (typeof privateStatus.node_name === "string") setHostName(privateStatus.node_name);
      const next = await listRemoteProjects();
      if (attempt !== generation.current) return;
      setProjects(next);
      if (currentProject) {
        const project = next.find(item => item.project_id === currentProject);
        if (!project || project.availability !== "online") {
          throw new Error(project ? `project_${project.availability}` : "project_not_available");
        }
        await openRemoteProject(currentProject);
      }
      if (attempt === generation.current) setPhase(currentProject ? "project" : "catalog");
    } catch (failure) {
      if (attempt !== generation.current) return;
      const reason = failure instanceof Error ? failure.message : String(failure);
      setError(reason);
      setPhase(reason === "e2ee_proof_invalid" || reason === "e2ee_secret_missing" ? "pairing" : "error");
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }, [currentProject]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void connect();
  }, [connect]);

  useEffect(() => {
    // Opening a new access link in this tab can change only the fragment;
    // browsers then keep the current document instead of mounting it again.
    const useAccessLink = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has("mindfs_pairing")) void connect();
    };
    window.addEventListener("hashchange", useAccessLink);
    return () => window.removeEventListener("hashchange", useAccessLink);
  }, [connect]);

  useEffect(() => {
    if (phase !== "project") return;
    return e2eeService.subscribe(state => {
      if (state.required && !state.secretPresent) {
        generation.current++;
        setPhase("error"); setError("project_authorization_expired");
      }
    });
  }, [phase]);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const attempt = generation.current;
    try {
      const next = await listRemoteProjects();
      if (attempt !== generation.current) return;
      setProjects(next); setError("");
      if (currentProject && !next.some(item => item.project_id === currentProject && item.availability === "online")) {
        e2eeService.clearSecret();
        setPhase("error"); setError("project_not_available");
      }
    } catch (failure) {
      if (attempt !== generation.current) return;
      const reason = failure instanceof Error ? failure.message : String(failure);
      setError(reason);
      if (["remote_access_disabled", "e2ee_proof_invalid", "e2ee_secret_missing"].includes(reason)) {
        e2eeService.clearSecret();
        setPhase(remoteHostE2EE.hasSecret() ? "error" : "pairing");
        setError(reason);
      }
    } finally { refreshing.current = false; }
  }, [currentProject]);
  useEffect(() => {
    if (phase !== "project" && phase !== "catalog") return;
    const interval = window.setInterval(() => void refresh(), 5000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [phase, refresh]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.showModal();
    void refresh();
  }, [menuOpen, refresh]);

  if (phase === "legacy") return <>{children}</>;

  const stateLabel = (state: RemoteProject["availability"]) => ({
    online: text("在线", "Online"), starting: text("启动中", "Starting"),
    closed: text("请在 IDEA 打开项目", "Open this project in IDEA"), error: text("启动失败，请在 IDEA 重试", "Startup failed; retry in IDEA"),
  })[state];
  const projectList = <div className="remote-project-list">
    {!projects.length ? <p>{text("还没有开放的项目。请在 IDEA 项目中点击远程访问。", "No projects are shared. Open Remote access in an IDEA project.")}</p> : null}
    {projects.map(project => <button type="button" key={project.project_id}
      className="remote-project-item" disabled={project.availability !== "online"}
      aria-current={project.project_id === currentProject ? "page" : undefined}
      onClick={() => project.project_id === currentProject ? setMenuOpen(false) : navigateRemoteProject(project.project_id)}>
      <span><strong>{project.name}</strong>{project.label ? <small>{project.label}</small> : null}</span>
      <small>{stateLabel(project.availability)}</small>
    </button>)}
  </div>;
  const errorMessage = (reason: string) => ({
    "Failed to fetch": text("暂时连不上你的电脑，请检查网络后重试。", "Cannot reach your computer. Check the network and retry."),
    relay_status_failed_502: text("电脑暂时离线，请确认电脑联网、IDEA 正在运行。", "Your computer is offline. Keep it online with IDEA running."),
    relay_status_failed_503: text("电脑暂时离线，请确认电脑联网、IDEA 正在运行。", "Your computer is offline. Keep it online with IDEA running."),
    project_closed: text("项目已关闭，请在 IDEA 中打开。", "The project is closed. Open it in IDEA."),
    project_starting: text("项目正在启动，请稍后重试。", "The project is starting. Retry shortly."),
    project_not_available: text("项目未开放或已离线，请在 IDEA 检查。", "This project is not shared or is offline. Check IDEA."),
    project_authorization_expired: text("项目连接需要重新验证，请重试。电脑配对信息仍保留。", "The project connection needs to be verified again. Retry using your saved computer pairing."),
    remote_access_disabled: text("这台电脑的远程访问已关闭。", "Remote access is disabled on this computer."),
  } as Record<string, string>)[reason] || reason;

  if (phase === "project") return <div className="remote-host-workspace">
    <nav className="remote-host-toolbar" aria-label={text("远程项目", "Remote project")}>
      <span>{hostName || text("我的电脑", "My computer")}</span>
      <button type="button" onClick={() => setMenuOpen(true)} aria-haspopup="dialog">
        {projects.find(project => project.project_id === currentProject)?.name || text("当前项目", "Current project")} ▾
      </button>
      {error ? <span role="status" className="remote-note">{text("连接暂时中断", "Connection interrupted")}</span> : null}
    </nav>
    {children}
    {menuOpen ? <dialog ref={menu} className="remote-access-dialog" onCancel={() => setMenuOpen(false)} aria-labelledby="remote-projects-title">
      <header><h2 id="remote-projects-title">{text("切换项目", "Switch project")}</h2><button type="button" onClick={() => setMenuOpen(false)} aria-label={text("关闭", "Close")}>×</button></header>
      {projectList}
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
      <button type="button" onClick={() => navigateRemoteProject("")}>{text("全部项目", "All projects")}</button>
    </dialog> : null}
  </div>;

  return <main className="remote-host-home"><section className="remote-host-card">
    <h1>{hostName || text("远程访问", "Remote access")}</h1>
    {phase === "loading" ? <p role="status">{text("正在连接你的电脑…", "Connecting to your computer…")}</p> : null}
    {phase === "pairing" ? <RemoteAccessRequired /> : null}
    {phase === "catalog" ? <><p>{text("选择一个项目继续工作", "Choose a project to continue")}</p>{projectList}</> : null}
    {error && phase !== "pairing" ? <p role="alert">{errorMessage(error)}</p> : null}
    {phase === "error" ? <div className="remote-actions"><button type="button" onClick={() => void connect()} disabled={busy}>{text("重试", "Retry")}</button>
      {currentProject ? <a href={`${remoteNodePrefix()}/`}>{text("返回项目列表", "Back to projects")}</a> : null}</div> : null}
  </section></main>;
}
