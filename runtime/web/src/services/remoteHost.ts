import { bootstrapService } from "./bootstrap";
import { hostPath } from "./base";
import { E2EEService, e2eeService } from "./e2ee";
import { consumePairingLink } from "./pairingLink";
import { remoteNodePrefix, remoteProjectId } from "./remoteScope";

export type RemoteProject = {
  project_id: string;
  name: string;
  label: string;
  availability: "starting" | "online" | "closed" | "error";
};
export type RemoteHostStatus = {
  remote_host?: boolean;
  e2ee_required?: boolean;
  e2ee_node_id?: string;
  node_name?: string;
  no_relayer?: boolean;
};

export const remoteHostE2EE = new E2EEService(() => hostPath("/api/e2ee/open"));
remoteHostE2EE.setClientId(`host-web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

let pairingSecretFromLink = "";

export async function readRemoteHostStatus(): Promise<RemoteHostStatus> {
  pairingSecretFromLink = consumePairingLink() || pairingSecretFromLink;
  const response = await fetch(hostPath("/api/relay/status"), { cache: "no-store" });
  if (!response.ok) throw new Error(`relay_status_failed_${response.status}`);
  const status: RemoteHostStatus = await response.json();
  if (!status || typeof status !== "object") throw new Error("remote_host_invalid_response");
  if (status.remote_host !== true) {
    if (remoteProjectId()) throw new Error("remote_host_required");
    bootstrapService.acceptPairingLinkSecret(pairingSecretFromLink);
    pairingSecretFromLink = "";
    return status;
  }
  if (status.e2ee_required !== true || typeof status.e2ee_node_id !== "string" || !status.e2ee_node_id) {
    throw new Error("remote_host_invalid_identity");
  }
  remoteHostE2EE.configure(true, status.e2ee_node_id);
  if (pairingSecretFromLink) {
    remoteHostE2EE.setSecret(pairingSecretFromLink);
    pairingSecretFromLink = "";
  }
  if (status.no_relayer === true) throw new Error("remote_access_disabled");
  return status;
}

export async function listRemoteProjects(): Promise<RemoteProject[]> {
  const payload = await remoteHostE2EE.protectedJSON<{ projects: unknown }>(hostPath("/api/remote/projects"));
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

export async function openRemoteProject(projectId: string): Promise<void> {
  const access = await remoteHostE2EE.protectedJSON<{
    project_id: string; e2ee_node_id: string; pairing_secret: string;
  }>(hostPath(`/api/remote/projects/${encodeURIComponent(projectId)}/access`), { method: "POST" });
  if (access.project_id !== projectId || typeof access.e2ee_node_id !== "string" || !access.e2ee_node_id ||
      typeof access.pairing_secret !== "string" || !access.pairing_secret) {
    throw new Error("remote_project_invalid_access");
  }
  e2eeService.useMemorySecret();
  e2eeService.configure(true, access.e2ee_node_id);
  e2eeService.setSecret(access.pairing_secret);
  try { await e2eeService.ensureSession(); } catch (error) {
    if (error instanceof Error && error.message === "e2ee_proof_invalid") throw new Error("project_authorization_expired");
    throw error;
  }
}

export function projectURL(projectId: string): string {
  const path = `${remoteNodePrefix()}/p/${encodeURIComponent(projectId)}/`;
  const saved = window.sessionStorage.getItem(`idea-remote-location:${path}`);
  // Only restore a same-project query, never a URL or pairing fragment.
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
