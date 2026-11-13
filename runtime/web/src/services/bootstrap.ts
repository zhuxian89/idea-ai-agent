import { appPath } from "./base";
import { e2eeService, type E2EEState } from "./e2ee";

export type RelayStatusPayload = {
  relay_bound?: boolean;
  no_relayer?: boolean;
  pending_code?: string;
  node_name?: string;
  node_id?: string;
  e2ee_node_id?: string;
  relay_base_url?: string;
  node_url?: string;
  last_error?: string;
  e2ee_required?: boolean;
};

export type BootstrapPhase = "idle" | "pending" | "ready" | "error";

export type BootstrapState = {
  phase: BootstrapPhase;
  relayStatus: RelayStatusPayload | null;
  e2ee: E2EEState;
  error: string;
};

type BootstrapListener = (state: BootstrapState) => void;

class BootstrapService {
  private state: BootstrapState = {
    phase: "idle",
    relayStatus: null,
    e2ee: e2eeService.snapshot(),
    error: "",
  };
  private listeners = new Set<BootstrapListener>();
  private startPromise: Promise<BootstrapState> | null = null;

  subscribe(listener: BootstrapListener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): BootstrapState {
    return {
      ...this.state,
      e2ee: e2eeService.snapshot(),
    };
  }

  canUseProtectedAPI(): boolean {
    const state = this.snapshot();
    return state.phase === "ready";
  }

  async start(): Promise<BootstrapState> {
    if (this.state.phase === "ready") {
      return this.snapshot();
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.runStart();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async refreshRelayStatus(): Promise<RelayStatusPayload | null> {
    const status = await fetchRelayStatus();
    if (status) {
      this.applyRelayStatus(status);
    }
    return status;
  }

  async startRelayBinding(): Promise<RelayStatusPayload | null> {
    const status = await postRelayBindStart();
    if (status) {
      this.applyRelayStatus(status);
    }
    return status;
  }

  private async runStart(): Promise<BootstrapState> {
    this.setState({ phase: "pending", error: "" });
    try {
      const status = await fetchRelayStatus();
      this.applyRelayStatus(status);
      this.setState({ phase: "ready", error: "" });
    } catch (err) {
      this.setState({ phase: "error", error: err instanceof Error ? err.message : "bootstrap_failed" });
    }
    return this.snapshot();
  }

  private applyRelayStatus(status: RelayStatusPayload | null) {
    e2eeService.configure(false, "");
    this.setState({ relayStatus: status });
  }

  private setState(patch: Partial<BootstrapState>) {
    this.state = {
      ...this.state,
      ...patch,
      e2ee: e2eeService.snapshot(),
    };
    this.emit();
  }

  private emit() {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

async function fetchRelayStatus(): Promise<RelayStatusPayload | null> {
  const response = await fetch(appPath("/api/relay/status"));
  if (!response.ok) throw new Error(`relay_status_failed_${response.status}`);
  return response.json();
}

async function postRelayBindStart(): Promise<RelayStatusPayload | null> {
  const target = appPath("/api/relay/bind/start");
  const init: RequestInit = {
    method: "POST",
  };
  const response = await fetch(target, init);
  if (!response.ok) {
    throw new Error(`relay_bind_start_failed_${response.status}`);
  }
  return response.json();
}

export const bootstrapService = new BootstrapService();
