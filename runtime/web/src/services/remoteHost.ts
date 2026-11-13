import { hostPath } from "./base";
import { remoteNodePrefix, remoteProjectId } from "./remoteScope";

export type RemoteProject = {
  project_id: string;
  name: string;
  label: string;
  availability: "starting" | "online" | "closed" | "error";
};
export type RemoteHostStatus = {
  remote_host?: boolean;
  node_name?: string;
  no_relayer?: boolean;
};

export async function readRemoteHostStatus(): Promise<RemoteHostStatus> {
  const response = await fetch(hostPath("/api/relay/status"), { cache: "no-store" });
  if (!response.ok) throw new Error(`relay_status_failed_${response.status}`);
  const status: RemoteHostStatus = await response.json();
  if (!status || typeof status !== "object") throw new Error("remote_host_invalid_response");
  if (!status.remote_host && remoteProjectId()) throw new Error("remote_host_required");
  if (status.no_relayer === true) throw new Error("remote_access_disabled");
  return status;
}

export async function listRemoteProjects(): Promise<RemoteProject[]> {
  const response = await fetch(hostPath("/api/remote/projects"), { cache: "no-store" });
  const payload: { projects: unknown; error?: string } = await response.json();
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `remote_projects_failed_${response.status}`);
  if (!Array.isArray(payload.projects)) throw new Error("remote_projects_invalid_response");
  return payload.projects.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("remote_projects_invalid_response");
    const project = value as Record<string, unknown>;
    if (typeof project.project_id !== "string" || !/^[A-Za-z0-9_-]+$/.test(project.project_id) ||
        typeof project.name !== "string" || typeof project.label !== "string" ||
        !["starting", "online", "closed", "error"].includes(String(project.availability))) {
      throw new Error("remote_projects_invalid_response");
    }
    return project as RemoteProject;
  });
}

export function projectURL(projectId: string): string {
  const path = `${remoteNodePrefix()}/p/${encodeURIComponent(projectId)}/`;
  const saved = window.sessionStorage.getItem(`idea-remote-location:${path}`);
  // Restore the saved query for this project.
  return saved?.startsWith("?") ? path + saved : path;
}

// The editor owns this event's cancellation. Normal links/back/reload are also
// protected by its existing beforeunload handler.
export function navigateRemoteProject(projectId: string): void {
  const event = new Event("idea:leave-remote-project", { cancelable: true });
  if (!window.dispatchEvent(event)) return;
  const current = remoteProjectId();
  if (current) {
    const path = `${remoteNodePrefix()}/p/${encodeURIComponent(current)}/`;
    window.sessionStorage.setItem(`idea-remote-location:${path}`, window.location.search);
  }
  window.dispatchEvent(new Event("idea:remote-project-leaving"));
  window.location.assign(projectId ? projectURL(projectId) : `${remoteNodePrefix()}/`);
}
