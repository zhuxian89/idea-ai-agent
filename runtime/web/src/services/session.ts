import { ACTIVITY_HISTORY_VERSION, hasCurrentActivityHistory } from "./sessionHistory";
import { RECONNECT_POLICY, connectTimeoutMs, retryDelayMs } from "./reconnectPolicy";
export { hasCurrentActivityHistory } from "./sessionHistory";
import { appURL, wsURL } from "./base";
import { ProtectedAPIError, protectedFetch, protectedJSON } from "./api";
import type { ActivityDetailResult, ActivityRef } from "./activityDetails";
import { e2eeService } from "./e2ee";
import {
  SessionType,
  RelatedFile,
  ExchangeAux,
  Session,
  SessionSearchHit,
  ToolCall,
  StreamEvent,
  SyncSessionResult,
  SessionEventHandler,
  SessionActivityState,
  SessionServiceEvent,
  FetchSessionsOptions,
  SessionListPayload,
  MultiRootSessionGroup,
  FetchExternalSessionsOptions,
  PendingMessage,
} from "./sessionTypes";
import {
  getSessionMaxSeq,
  toPersistentExchangeAux,
  withSessionMeta,
  appendSessionDelta,
  saveCachedSession,
  cloneSession,
  getCachedSession,
} from "./sessionCache";
import { estimateCommandTerminalCols } from "./commandTerminal";
export {
  SESSION_CACHE_VERSION,
  applySessionCacheUpgrade,
  getCachedSessionList,
  saveCachedSessionList,
  getCachedMultiRootSessionList,
  saveCachedMultiRootSessionList,
  deleteCachedSession,
  clearCachedSessionsForRoot,
  getCachedSession,
  setCachedSessionRelatedFiles,
} from "./sessionCache";
export type {
  SessionType,
  QueuedUserMessage,
  RelatedFile,
  RelatedWorktree,
  ExchangeAux,
  TurnDiffUpdate,
  Session,
  SessionSearchHit,
  ToolCallLocation,
  ToolCallContentItem,
  ToolCall,
  TodoItem,
  TodoUpdate,
  PlanUpdate,
  CompactNotice,
  StreamEvent,
  SyncSessionResult,
  SessionServiceEvent,
  SessionListPayload,
  MultiRootSessionGroup,
  FetchExternalSessionsOptions,
} from "./sessionTypes";

class SessionService {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<SessionEventHandler>>();
  private pendingStreams = new Map<string, StreamEvent[]>();
  private activeStreams = new Set<string>();
  private sessionActivity = new Map<string, SessionActivityState>();
  private failedSessions = new Map<string, { sending: boolean; requestId?: string }>();
  private eventCursors = new Map<string, string>();
  private pendingMessages = new Map<string, PendingMessage>();
  private pendingAnswers = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(event: SessionServiceEvent) => void>();
  private reconnectTimer: number | null = null;
  private connectTimeoutTimer: number | null = null;
  private probeTimeoutTimer: number | null = null;
  private activeProbeId: string | null = null;
  private connectingStartedAt = 0;
  private openingSocket = false;
  /** Attempts in a row that did not become healthy; drives the backoff and the connect timeout. */
  private failures = 0;
  private healthyTimer: number | null = null;
  private openedAt = 0;
  private lastInboundAt = 0;
  private lastWakeAt = 0;
  private rootId: string | null = null;
  private hasConnected = false;
  private readonly clientId = this.generateClientId();
  private readonly reconnectWatchdogMs = 3000;
  private contextCache = new Map<string, { selectionKey: string }>();

  constructor() {
    e2eeService.setClientId(this.clientId);
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.onWake());
      window.addEventListener("pageshow", () => this.onWake());
      window.addEventListener("focus", () => this.onWake());
      window.setInterval(() => this.ensureReconnectLoop(), this.reconnectWatchdogMs);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          this.onWake();
        }
      });
    }
  }

  private generateClientId(): string {
    return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  createRequestId(prefix = "msg"): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async buildWSUrl(): Promise<string> {
    const params = new URLSearchParams({ client_id: this.clientId });
    const proofTarget = wsURL("/ws", params);
    if (e2eeService.isRequired()) {
      const proofParams = await e2eeService.wsProofParams("GET", proofTarget);
      for (const [key, value] of proofParams) {
        params.set(key, value);
      }
    }
    return wsURL("/ws", params);
  }

  connect(rootId: string) {
    if (this.rootId !== rootId) {
      // A different project is an explicit request, not a retry: start from a clean slate.
      this.failures = 0;
    }
    this.rootId = rootId;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.emit({ type: this.hasConnected ? "ws.reconnected" : "ws.connected" });
      this.hasConnected = true;
      return;
    }
    if (this.openingSocket || this.ws?.readyState === WebSocket.CONNECTING) {
      if (this.connectAttemptExpired()) {
        this.failAndRetry("connect_timeout");
        return;
      }
      this.emit({ type: this.hasConnected ? "ws.reconnecting" : "ws.connecting" });
      return;
    }

    this.clearReconnectTimer();
    this.closeSocket();
    this.emit({ type: this.hasConnected ? "ws.reconnecting" : "ws.connecting" });

    void this.openSocket();
  }

  private async openSocket() {
    if (this.openingSocket) {
      return;
    }
    this.openingSocket = true;
    let target = "";
    try {
      target = await this.buildWSUrl();
    } catch (err) {
      this.openingSocket = false;
      console.error("[Session] Failed to prepare WebSocket proof:", err);
      this.emit({ type: "ws.closed", payload: { code: 0, reason: "e2ee_proof_failed", was_clean: false } });
      this.failures += 1;
      this.scheduleReconnect();
      return;
    }
    if (!this.rootId || this.ws) {
      this.openingSocket = false;
      return;
    }
    const ws = new WebSocket(target);
    this.openingSocket = false;
    this.ws = ws;
    this.connectingStartedAt = Date.now();
    const allowedMs = connectTimeoutMs(this.failures);
    this.connectTimeoutTimer = window.setTimeout(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.CONNECTING) return;
      console.warn(`[Session] WebSocket connect timed out after ${allowedMs}ms (failures=${this.failures})`);
      this.failAndRetry("connect_timeout");
    }, allowedMs);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.clearConnectTimeout();
      this.clearProbe();
      this.openedAt = Date.now();
      this.lastInboundAt = this.openedAt;
      // Only a connection that stays up counts as a recovery. Opening is not enough: on a slow
      // path a socket can open and be dropped again moments later, and that must keep backing off.
      this.clearHealthyTimer();
      this.healthyTimer = window.setTimeout(() => {
        this.healthyTimer = null;
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) this.failures = 0;
      }, RECONNECT_POLICY.healthyAfterMs);
      if (this.hasConnected) {
        this.emit({ type: "ws.reconnected" });
      } else {
        this.emit({ type: "ws.connected" });
      }
      this.hasConnected = true;
      if (e2eeService.isRequired() && e2eeService.hasSecret()) {
        void e2eeService.ensureSession().catch((err) => {
          console.error("[Session] Failed to open E2EE session:", err);
        });
      }
      this.resendPendingMessages();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.lastInboundAt = Date.now();
      this.clearProbe();
      void (async () => {
        try {
          const msg = await this.parseWSMessage(event.data);
          if (!msg) {
            return;
          }
          this.handleMessage(msg);
        } catch (err) {
          console.error("[Session] Failed to parse message:", err);
        }
      })();
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.rejectPendingAnswers();
      this.clearConnectTimeout();
      this.clearHealthyTimer();
      this.ws = null;
      this.emit({
        type: "ws.closed",
        payload: {
          code: event.code,
          reason: event.reason,
          was_clean: event.wasClean,
        },
      });
      this.failures += 1;
      this.scheduleReconnect();
    };

    ws.onerror = (err) => {
      if (this.ws !== ws) return;
      console.error("[Session] WebSocket error:", err);
    };
  }

  disconnect() {
    this.rootId = null;
    this.clearReconnectTimer();
    this.clearConnectTimeout();
    this.clearProbe();
    this.closeSocket();
    this.contextCache.clear();
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectTimeout() {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    this.connectingStartedAt = 0;
  }

  private clearProbe() {
    if (this.probeTimeoutTimer) {
      clearTimeout(this.probeTimeoutTimer);
      this.probeTimeoutTimer = null;
    }
    this.activeProbeId = null;
  }

  private closeSocket() {
    this.rejectPendingAnswers();
    this.clearConnectTimeout();
    this.clearProbe();
    this.openingSocket = false;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      ws.close();
    }
  }

  private connectAttemptExpired(): boolean {
    return (
      this.connectingStartedAt > 0 &&
      Date.now() - this.connectingStartedAt > connectTimeoutMs(this.failures)
    );
  }

  /**
   * The page came back to the foreground or the network returned. The socket may have died while
   * the page was away, so this is the one moment a prompt check is worth it: a missing socket is
   * opened now (the wait is skipped, the failure count is not), an open one gets a short probe.
   * An attempt that is already in progress is left alone.
   */
  private onWake() {
    if (!this.rootId) return;
    const now = Date.now();
    if (now - this.lastWakeAt < RECONNECT_POLICY.wakeCooldownMs) return;
    this.lastWakeAt = now;
    if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
      if (this.openingSocket) return;
      this.clearReconnectTimer();
      this.connect(this.rootId);
      return;
    }
    if (this.ws.readyState === WebSocket.CONNECTING) {
      if (this.connectAttemptExpired()) this.failAndRetry("connect_timeout");
      return;
    }
    this.probeConnection(RECONNECT_POLICY.wakeProbeTimeoutMs);
  }

  /** Safety net every few seconds. It never connects ahead of a pending retry: that is the backoff. */
  private ensureReconnectLoop() {
    if (!this.rootId) return;
    if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
      if (!this.reconnectTimer && !this.openingSocket) this.scheduleReconnect();
      return;
    }
    if (this.ws.readyState === WebSocket.CONNECTING) {
      if (this.connectAttemptExpired()) this.failAndRetry("connect_timeout");
      return;
    }
    if (
      this.ws.readyState === WebSocket.OPEN &&
      !this.activeProbeId &&
      Date.now() - this.lastInboundAt > RECONNECT_POLICY.probeIdleMs
    ) {
      this.probeConnection(RECONNECT_POLICY.probeTimeoutMs);
    }
  }

  /** Give up on the current socket, count it as a failure and retry after the backoff. */
  private failAndRetry(reason: string) {
    if (!this.rootId) return;
    this.clearReconnectTimer();
    this.clearProbe();
    this.clearHealthyTimer();
    this.closeSocket();
    this.failures += 1;
    console.warn(`[Session] connection dropped (${reason}); failures=${this.failures}`);
    this.scheduleReconnect();
  }

  private probeConnection(timeoutMs: number) {
    if (!this.rootId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (this.activeProbeId) return;
    const probeId = this.createRequestId("ping");
    this.activeProbeId = probeId;
    void this.sendWSMessage({
      id: probeId,
      type: "ping",
      payload: {},
    }).catch((err) => {
      console.error("[Session] Failed to send probe:", err);
    });
    this.probeTimeoutTimer = window.setTimeout(() => {
      if (this.activeProbeId !== probeId) return;
      console.warn(`[Session] WebSocket probe got no reply in ${timeoutMs}ms`);
      this.failAndRetry("probe_timeout");
    }, timeoutMs);
  }

  private buildSelectionKey(selection: unknown): string {
    if (!selection || typeof selection !== "object") return "";
    const raw = selection as Record<string, unknown>;
    const filePath = typeof raw.file_path === "string" ? raw.file_path : "";
    const startLine = typeof raw.start_line === "number" ? raw.start_line : -1;
    const endLine = typeof raw.end_line === "number" ? raw.end_line : -1;
    const text = typeof raw.text === "string" ? raw.text : "";
    return `${filePath}:${startLine}:${endLine}:${text}`;
  }

  private compactContext(
    sessionKey: string | undefined,
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!context) return undefined;
    const next = { ...context };
    const selection =
      next.selection && typeof next.selection === "object"
        ? (next.selection as Record<string, unknown>)
        : undefined;
    const selectionKey = this.buildSelectionKey(selection);

    if (sessionKey) {
      const prev = this.contextCache.get(sessionKey);
      if (prev && prev.selectionKey === selectionKey) {
        delete next.selection;
      }
      this.contextCache.set(sessionKey, { selectionKey });
    }
    return next;
  }

  private scheduleReconnect() {
    if (!this.rootId) return;
    if (this.reconnectTimer) return;
    const delay = retryDelayMs(Math.max(1, this.failures));
    console.info(`[Session] reconnecting in ${delay}ms (failures=${this.failures})`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.rootId) {
        this.connect(this.rootId);
      }
    }, delay);
  }

  private clearHealthyTimer() {
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = null;
    }
  }

  private handleMessage(msg: any) {
    const type = msg.type as string;
    const payload = msg.payload || {};
    if (typeof msg.id === "string" && this.pendingAnswers.has(msg.id)) {
      if (type === "session.answer_question.accepted") {
        this.finishAnswer(msg.id);
        return;
      }
      if (type === "session.error" || type === "error" || type === "e2ee.error") {
        this.finishAnswer(msg.id, new Error(msg.error?.message || payload.message || "回答未被接收，请重试"));
        return;
      }
    }
    if (type === "pong") {
      return;
    }
    if (type === "e2ee.error") {
      const code = typeof payload.code === "string" ? payload.code : "";
      e2eeService.handleServerError(code);
      this.emit({ type, payload });
      return;
    }
    let sessionKey = payload.session_key as string;
    if (type === "session.accepted") {
      const requestId =
        typeof payload.request_id === "string"
          ? payload.request_id
          : typeof msg.id === "string"
            ? msg.id
            : "";
      if (requestId) {
        this.pendingMessages.delete(requestId);
      }
    } else if (type === "session.error" && typeof msg.id === "string") {
      // Request rejection envelopes have no session metadata. Recover it before
      // removing the pending message so manual continuations can unlock safely.
      const pending = this.pendingMessages.get(msg.id);
      const target = pending?.message.payload as { root_id?: string; session_key?: string } | undefined;
      if (target && this.getSessionFailure(target.root_id || "", target.session_key || "")?.requestId === msg.id) {
        payload.root_id ||= target.root_id;
        payload.session_key ||= target.session_key;
        sessionKey = payload.session_key as string;
      }
      this.pendingMessages.delete(msg.id);
      payload.request_id = msg.id;
    }
    this.emitDecrypted(type, sessionKey, payload, msg);
  }

  private emitDecrypted(
    type: string,
    sessionKey: string,
    payload: Record<string, unknown>,
    msg: any,
  ) {
    const nextPayload = { ...payload };
    if (sessionKey) {
      this.updateActiveStreamState(type, sessionKey, nextPayload);
      this.updateSessionActivity(type, sessionKey, nextPayload);
      const rootId = typeof nextPayload.root_id === "string" ? nextPayload.root_id : "";
      const key = this.eventCursorKey(rootId, sessionKey);
      const event = nextPayload.event as StreamEvent | undefined;
      if (key && (type === "session.error" || (type === "session.stream" && event?.type === "error"))) {
        this.failedSessions.set(key, { sending: false });
      } else if (key && type === "session.user_message") {
        this.failedSessions.delete(key);
      } else if (key && type === "session.done" && this.failedSessions.get(key)?.requestId
        && this.failedSessions.get(key)?.requestId === nextPayload.request_id) {
        // Reconnecting may replay only completion, without another user message.
        this.failedSessions.delete(key);
      }
    }
    this.emit({ type, sessionKey, payload: nextPayload });

    if (!sessionKey) return;
    const rootId =
      typeof nextPayload.root_id === "string" ? nextPayload.root_id : "";
    const cursorKey = this.eventCursorKey(rootId, sessionKey);
    if (type === "session.stream") {
      const event = nextPayload.event as StreamEvent | undefined;
      if (event?.event_cursor && cursorKey) {
        this.eventCursors.set(cursorKey, event.event_cursor);
      }
    } else if (type === "session.user_message" && cursorKey) {
      this.eventCursors.delete(cursorKey);
    } else if (type === "session.done" && cursorKey) {
      this.eventCursors.delete(cursorKey);
    }
    const handlers = this.handlers.get(sessionKey);
    if ((!handlers || handlers.size === 0) && type === "session.stream") {
      const event = nextPayload.event as StreamEvent;
      if (event && event.type !== "question_answered") {
        const queued = this.pendingStreams.get(sessionKey) || [];
        queued.push(event);
        this.pendingStreams.set(sessionKey, queued);
      }
      return;
    }
    if (!handlers || handlers.size === 0) return;

    switch (type) {
      case "session.user_message":
        for (const handler of handlers) {
          handler.onUserMessage?.();
        }
        break;
      case "session.stream":
        for (const handler of handlers) {
          handler.onStream?.(nextPayload.event as StreamEvent);
        }
        break;
      case "session.done":
        for (const handler of handlers) {
          handler.onDone?.();
        }
        break;
      case "session.error":
        for (const handler of handlers) {
          handler.onError?.(msg.error?.message || "Unknown error");
        }
        break;
    }
  }

  private async parseWSMessage(raw: unknown): Promise<any | null> {
    if (typeof raw !== "string") {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!e2eeService.isRequired() || parsed?.type === "e2ee.error") {
      return parsed;
    }
    return e2eeService.decodeWSMessage<any>(raw);
  }

  private async sendWSMessage(
    message: Record<string, unknown>,
  ): Promise<boolean> {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // Someone is waiting on this message, so do not sit out the backoff: try now (rate limited).
      this.onWake();
      return false;
    }
    let serialized = JSON.stringify(message);
    if (e2eeService.isRequired()) {
      await e2eeService.ensureSession();
      serialized = await e2eeService.encodeWSMessage(message);
    }
    if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) return false;
    if (message.type === "session.answer_question" && !this.pendingAnswers.has(String(message.id))) return false;
    socket.send(serialized);
    return true;
  }

  subscribeEvents(listener: (event: SessionServiceEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SessionServiceEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private updateActiveStreamState(
    type: string,
    sessionKey: string,
    payload: Record<string, unknown>,
  ) {
    if (type === "session.done" || type === "session.error") {
      this.activeStreams.delete(sessionKey);
      // Content is already delivered to global listeners. Replaying these
      // transient events on a later mount would restart a completed spinner.
      this.pendingStreams.delete(sessionKey);
      return;
    }
    if (type !== "session.stream") return;
    const event = payload.event as StreamEvent | undefined;
    if (!event) return;
    if (event.type === "question_answered") return;
    if (event.type === "error") {
      this.activeStreams.delete(sessionKey);
      return;
    }
    if (event.type !== "message_done") {
      this.activeStreams.add(sessionKey);
    }
  }

  isSessionStreaming(sessionKey: string) {
    return this.activeStreams.has(sessionKey);
  }

  getSessionFailure(rootId: string, sessionKey: string) {
    return this.failedSessions.get(this.eventCursorKey(rootId, sessionKey));
  }

  // Explicit continuation, not replay of a potentially side-effectful request.
  // Keep the lock through acceptance until the authoritative user-message event.
  async continueFailedSession(rootId: string, session: Partial<Pick<Session, "key" | "session_key" | "agent" | "model" | "mode" | "effort" | "fast_service">> & { type?: string; pending?: boolean }, content: string): Promise<boolean> {
    const sessionKey = session.key || session.session_key || "";
    const key = this.eventCursorKey(rootId, sessionKey);
    const failure = this.failedSessions.get(key);
    if (!failure || failure.sending || this.isSessionStreaming(sessionKey)
      || session.pending || (session.type && session.type !== "chat" && session.type !== "plugin")
      || !session.agent || !content.trim() || (typeof navigator !== "undefined" && !navigator.onLine)
      || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const requestId = this.createRequestId("continue");
    this.failedSessions.set(key, { sending: true, requestId });
    this.emit({ type: "session.recovery_changed", sessionKey, payload: { root_id: rootId } });
    try {
      const sent = await this.sendMessage(rootId, sessionKey, content, session.type === "plugin" ? "plugin" : "chat",
        session.agent, session.model, session.mode, session.effort, session.fast_service,
        undefined, undefined, requestId);
      if (sent) return true;
    } catch {
      // A failed dispatch must leave a usable manual action, never an auto retry.
    }
    this.pendingMessages.delete(requestId);
    this.failedSessions.set(key, { sending: false });
    this.emit({ type: "session.recovery_changed", sessionKey, payload: { root_id: rootId } });
    return false;
  }

  private updateSessionActivity(
    type: string,
    sessionKey: string,
    payload: Record<string, unknown>,
  ) {
    if (type === "session.done" || type === "session.error") {
      this.sessionActivity.delete(sessionKey);
      return;
    }
    const previous = this.sessionActivity.get(sessionKey);
    if (type === "session.user_message") {
      const exchange = payload.exchange as { timestamp?: string } | undefined;
      const userTimestamp = exchange?.timestamp;
      // The authoritative user message can be delivered more than once.
      if (userTimestamp && userTimestamp === previous?.userTimestamp) return;
      this.sessionActivity.set(sessionKey, { lastEventAt: 0, recoveryMessage: null, userTimestamp });
      this.pendingStreams.delete(sessionKey);
      this.activeStreams.delete(sessionKey);
      return;
    }
    if (type !== "session.stream") return;
    const event = payload.event as StreamEvent | undefined;
    if (!event) return;
    if (event.type === "question_answered") return;
    // Replay cursors may be cleared when the timeline is reloaded. Keep our
    // activity cursor separately so already observed events do not look fresh.
    const cursor = event.event_cursor?.match(/^(\d+):(\d+)$/);
    const previousCursor = previous?.eventCursor?.match(/^(\d+):(\d+)$/);
    if (cursor && previousCursor && cursor[1] === previousCursor[1]
      && BigInt(cursor[2]) <= BigInt(previousCursor[2])) return;
    this.sessionActivity.set(sessionKey, {
      ...previous,
      lastEventAt: Date.now(),
      eventCursor: event.event_cursor || previous?.eventCursor,
      recoveryMessage: event.type === "recovery" ? event.data?.message || ""
        : event.type === "message_done" ? previous?.recoveryMessage ?? null : null,
    });
  }

  getSessionActivity(sessionKey: string): Readonly<SessionActivityState> | undefined {
    return this.sessionActivity.get(sessionKey);
  }

  private eventCursorKey(rootId: string, sessionKey: string): string {
    if (!rootId || !sessionKey) return "";
    return `${rootId}::${sessionKey}`;
  }

  getEventCursor(rootId: string, sessionKey: string): string {
    return this.eventCursors.get(this.eventCursorKey(rootId, sessionKey)) || "";
  }

  clearEventCursor(rootId: string, sessionKey: string) {
    this.eventCursors.delete(this.eventCursorKey(rootId, sessionKey));
  }

  subscribe(sessionKey: string, handler: SessionEventHandler) {
    let set = this.handlers.get(sessionKey);
    if (!set) {
      set = new Set<SessionEventHandler>();
      this.handlers.set(sessionKey, set);
    }
    set.add(handler);

    const queued = this.pendingStreams.get(sessionKey);
    if (queued && queued.length > 0) {
      for (const event of queued) {
        handler.onStream?.(event);
      }
      this.pendingStreams.delete(sessionKey);
    }

    return () => {
      const current = this.handlers.get(sessionKey);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(sessionKey);
      }
    };
  }

  async sendMessage(
    rootId: string,
    sessionKey: string | undefined,
    content: string,
    type: SessionType,
    agent: string,
    model?: string,
    agentMode?: string,
    effort?: string,
    fastService?: string,
    context?: Record<string, unknown>,
    shell?: string,
    requestId = this.createRequestId("msg"),
  ): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[session/send] blocked", {
        requestId,
        rootId,
        sessionKey: sessionKey || null,
        readyState: this.ws?.readyState ?? null,
      });
      return false;
    }

    if (sessionKey) {
      this.eventCursors.delete(this.eventCursorKey(rootId, sessionKey));
    }

    const msg = {
      id: requestId,
      type: "session.message",
      payload: {
        root_id: rootId,
        session_key: sessionKey || undefined,
        content,
        type,
        agent,
        model,
        agent_mode: agentMode,
        effort,
        fast_service: fastService,
        shell,
        terminal_cols: type === "command" ? estimateCommandTerminalCols() : undefined,
        context: this.compactContext(sessionKey, context),
      },
    };

    return this.sendTracked(requestId, msg);
  }

  // Reconnect only resends messages already sent and still awaiting server acceptance.
  private async sendTracked(
    requestId: string,
    msg: Record<string, unknown>,
  ): Promise<boolean> {
    const sent = await this.sendWSMessage(msg);
    if (sent) {
      this.pendingMessages.set(requestId, { id: requestId, message: msg });
    }
    return sent;
  }

  async setPlanMode(
    rootId: string,
    sessionKey: string,
    enabled: boolean,
    requestId = this.createRequestId("plan"),
  ): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!rootId || !sessionKey) {
      return false;
    }
    return this.sendWSMessage({
      id: requestId,
      type: "session.plan_mode.set",
      payload: {
        root_id: rootId,
        session_key: sessionKey,
        enabled,
      },
    });
  }

  async runSlashCommand(
    rootId: string,
    sessionKey: string,
    command: string,
    agent: string,
    model?: string,
    agentMode?: string,
    effort?: string,
    fastService?: string,
    requestId = this.createRequestId("slash"),
  ): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!rootId || !sessionKey || !command || !agent) {
      return false;
    }
    const msg = {
      id: requestId,
      type: "session.slash_command.run",
      payload: {
        root_id: rootId,
        session_key: sessionKey,
        command,
        agent,
        model,
        agent_mode: agentMode,
        effort,
        fast_service: fastService,
      },
    };
    return this.sendTracked(requestId, msg);
  }

  private resendPendingMessages() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    for (const pending of this.pendingMessages.values()) {
      void this.sendWSMessage(pending.message).catch((err) => {
        console.error("[Session] Failed to resend message:", err);
      });
    }
  }

  async cancelMessage(rootId: string, sessionKey: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[Session] WebSocket not connected");
      return false;
    }
    if (!rootId || !sessionKey) {
      return false;
    }

    const msg = {
      id: `cancel-${Date.now()}`,
      type: "session.cancel",
      payload: {
        root_id: rootId,
        session_key: sessionKey,
      },
    };

    return this.sendWSMessage(msg);
  }

  async removeQueuedMessage(rootId: string, sessionKey: string, queueId: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !rootId || !sessionKey || !queueId) {
      return false;
    }
    return this.sendWSMessage({
      id: `queue-remove-${Date.now()}`,
      type: "session.queue.remove",
      payload: {
        root_id: rootId,
        session_key: sessionKey,
        queue_id: queueId,
      },
    });
  }

  async updateQueuedMessage(rootId: string, sessionKey: string, queueId: string, content: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !rootId || !sessionKey || !queueId || !content.trim()) {
      return false;
    }
    return this.sendWSMessage({
      id: `queue-update-${Date.now()}`,
      type: "session.queue.update",
      payload: {
        root_id: rootId,
        session_key: sessionKey,
        queue_id: queueId,
        content,
      },
    });
  }

  async sendQueuedMessageNow(rootId: string, sessionKey: string, queueId: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !rootId || !sessionKey || !queueId) {
      return false;
    }
    return this.sendWSMessage({
      id: `queue-send-now-${Date.now()}`,
      type: "session.queue.send_now",
      payload: {
        root_id: rootId,
        session_key: sessionKey,
        queue_id: queueId,
      },
    });
  }

  async answerQuestion(
    rootId: string,
    sessionKey: string,
    agent: string | undefined,
    toolUseId: string,
    answers: Record<string, string>,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("连接已断开，请等待重新连接后重试");
    }
    if (!rootId || !sessionKey || !toolUseId) {
      throw new Error("问题信息不完整，请重新打开会话");
    }

    const msg = {
      id: this.createRequestId("answer"),
      type: "session.answer_question",
      payload: {
        root_id: rootId,
        session_key: sessionKey,
        agent,
        tool_use_id: toolUseId,
        answers,
      },
    };

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.finishAnswer(msg.id, new Error("尚未收到回答确认，请检查会话状态后重试")), 30000);
      this.pendingAnswers.set(msg.id, { resolve, reject, timer });
      this.sendWSMessage(msg).then((sent) => {
        if (!sent) this.finishAnswer(msg.id, new Error("连接已断开，回答未发送"));
      }, (error) => this.finishAnswer(msg.id, error instanceof Error ? error : new Error(String(error))));
    });
  }

  private finishAnswer(id: string, error?: Error) {
    const pending = this.pendingAnswers.get(id);
    if (!pending) return;
    this.pendingAnswers.delete(id);
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  private rejectPendingAnswers() {
    for (const id of this.pendingAnswers.keys()) {
      this.finishAnswer(id, new Error("连接已断开，请重新连接并检查回答状态"));
    }
  }

  async markSessionReady(rootId: string, sessionKey: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!rootId || !sessionKey) {
      return false;
    }
    const now = Date.now();
    if (e2eeService.isRequired()) {
      await e2eeService.ensureSession();
    }
    const eventCursor = this.eventCursors.get(
      this.eventCursorKey(rootId, sessionKey),
    );
    return this.sendWSMessage({
      id: `ready-${now}`,
      type: "session.ready",
      payload: {
        root_id: rootId,
        session_key: sessionKey,
        ...(eventCursor ? { event_cursor: eventCursor } : {}),
      },
    });
  }

  async fetchSessions(
    rootId: string,
    options?: FetchSessionsOptions,
  ): Promise<SessionListPayload> {
    try {
      const params = new URLSearchParams({ root: rootId });
      if (options?.beforeTime) {
        params.set("before_time", options.beforeTime);
      }
      if (options?.afterTime) {
        params.set("after_time", options.afterTime);
      }
      if (typeof options?.limit === "number" && options.limit > 0) {
        params.set("limit", String(options.limit));
      }
      if (options?.topLevel) {
        params.set("top_level", "1");
      }
      if (options?.includeChildren) {
        params.set("include_children", "1");
      }
      const data = await protectedJSON<any>(appURL("/api/sessions", params));
      if (Array.isArray(data)) {
        return { items: data, pinnedItems: [], pinnedKeys: [], totalCount: data.length };
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      const pinnedItems = Array.isArray(data?.pinned_items) ? data.pinned_items : [];
      const pinnedKeys = Array.isArray(data?.pinned_keys)
        ? data.pinned_keys.map((key: unknown) => String(key || "")).filter(Boolean)
        : pinnedItems.map((item: any) => String(item?.key || item?.session_key || "")).filter(Boolean);
      const totalCount = Number(data?.total_count ?? data?.totalCount ?? items.length) || 0;
      return { items, pinnedItems, pinnedKeys, totalCount };
    } catch (err) {
      console.error("[Session] Failed to fetch sessions:", err);
      return { items: [], pinnedItems: [], pinnedKeys: [], totalCount: 0 };
    }
  }

  async fetchMultiRootSessions(limitPerRoot = 6): Promise<MultiRootSessionGroup[]> {
    try {
      const params = new URLSearchParams({ multi_root: "1" });
      if (limitPerRoot > 0) {
        params.set("limit_per_root", String(limitPerRoot));
      }
      const data = await protectedJSON<any>(appURL("/api/sessions", params));
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      return groups.map((group: any) => ({
        rootId: String(group?.root_id || group?.rootId || ""),
        rootName: String(group?.root_name || group?.rootName || ""),
        latestSessionTime: String(group?.latest_session_time || group?.latestSessionTime || ""),
        items: Array.isArray(group?.items) ? group.items : [],
        pinnedItems: Array.isArray(group?.pinned_items) ? group.pinned_items : [],
        pinnedKeys: Array.isArray(group?.pinned_keys)
          ? group.pinned_keys.map((key: unknown) => String(key || "")).filter(Boolean)
          : Array.isArray(group?.pinned_items)
            ? group.pinned_items.map((item: any) => String(item?.key || item?.session_key || "")).filter(Boolean)
            : [],
        totalCount: Number(group?.total_count ?? group?.totalCount ?? 0) || 0,
      })).filter((group: MultiRootSessionGroup) => !!group.rootId);
    } catch (err) {
      if (err instanceof Error && err.message === "api_not_ready") {
        return [];
      }
      console.error("[Session] Failed to fetch multi-root sessions:", err);
      return [];
    }
  }

  async fetchChildSessions(
    rootId: string,
    parentSessionKey: string,
    options?: { beforeTime?: string; limit?: number },
  ): Promise<Session[]> {
    try {
      const params = new URLSearchParams({
        root: rootId,
        parent_session_key: parentSessionKey,
      });
      if (options?.beforeTime) {
        params.set("before_time", options.beforeTime);
      }
      if (typeof options?.limit === "number" && options.limit > 0) {
        params.set("limit", String(options.limit));
      }
      const data = await protectedJSON<any[]>(appURL("/api/sessions/children", params));
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error("[Session] Failed to fetch child sessions:", err);
      return [];
    }
  }

  async searchSessions(
    rootId: string,
    query: string,
    limit?: number,
    options?: { multiRoot?: boolean },
  ): Promise<SessionSearchHit[]> {
    try {
      const trimmed = query.trim();
      if ((!rootId && !options?.multiRoot) || !trimmed) {
        return [];
      }
      const params = new URLSearchParams({ q: trimmed });
      if (options?.multiRoot) {
        params.set("multi_root", "1");
      } else {
        params.set("root", rootId);
      }
      if (typeof limit === "number" && limit > 0) {
        params.set("limit", String(limit));
      }
      const data = await protectedJSON<any>(appURL("/api/sessions/search", params));
      return Array.isArray(data?.items)
        ? (data.items as SessionSearchHit[])
        : [];
    } catch (err) {
      console.error("[Session] Failed to search sessions:", err);
      return [];
    }
  }

  async getSessionLogPath(rootId: string, sessionKey: string): Promise<{ path: string; agentSessionId: string }> {
    const data = await protectedJSON<{ path: string; agent_session_id?: string }>(
      appURL(`/api/sessions/${encodeURIComponent(sessionKey)}/log-path`, new URLSearchParams({ root: rootId })),
    );
    return { path: data.path, agentSessionId: data.agent_session_id || "" };
  }

  async getSession(
    rootId: string,
    sessionKey: string,
    seq?: number,
  ): Promise<Session | null> {
    try {
      const params = new URLSearchParams({ root: rootId });
      if (typeof seq === "number" && seq > 0) {
        params.set("seq", String(seq));
      }
      const data = await protectedJSON<Session>(
        appURL(`/api/sessions/${encodeURIComponent(sessionKey)}`, params),
      );
      return data as Session;
    } catch (err) {
      console.error("[Session] Failed to get session:", err);
      return null;
    }
  }

  async syncExternalSession(
    rootId: string,
    sessionKey: string,
    seq?: number,
  ): Promise<Session | null> {
    try {
      const params = new URLSearchParams({ root: rootId });
      if (typeof seq === "number" && seq > 0) {
        params.set("seq", String(seq));
      }
      const data = await protectedJSON<Session>(
        appURL(`/api/sessions/${encodeURIComponent(sessionKey)}/sync`, params),
        { method: "POST" },
      );
      return data as Session;
    } catch (err) {
      console.error("[Session] Failed to sync session:", err);
      return null;
    }
  }

  async getToolCall(
    rootId: string,
    sessionKey: string,
    callId: string,
  ): Promise<ToolCall | null> {
    const result = await this.getToolCallDetails({ rootId, sessionKey, callId });
    return result.kind === "loaded" ? result.toolCall : null;
  }

  async getToolCallDetails(
    { rootId, sessionKey, callId }: ActivityRef,
    signal?: AbortSignal,
  ): Promise<ActivityDetailResult> {
    try {
      if (!rootId || !sessionKey || !callId) return { kind: "missing" };
      const params = new URLSearchParams({ root: rootId });
      const data = await protectedJSON<{ toolcall?: ToolCall; toolCall?: ToolCall } | ToolCall>(
        appURL(
          `/api/sessions/${encodeURIComponent(sessionKey)}/toolcalls/${encodeURIComponent(callId)}`,
          params,
        ),
        { signal },
      );
      const wrapped = data as { toolcall?: ToolCall; toolCall?: ToolCall };
      const toolCall = wrapped?.toolcall || wrapped?.toolCall || data as ToolCall;
      return toolCall?.callId ? { kind: "loaded", toolCall } : { kind: "missing" };
    } catch (err) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const status = err instanceof ProtectedAPIError ? err.status : undefined;
      if (status === 404) return { kind: "missing" };
      const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
      return { kind: "unavailable", retryable,
        message: retryable ? "toolActivity.detailsUnavailable" : "toolActivity.detailsRestricted" };
    }
  }

  async getSessionRelatedFiles(
    rootId: string,
    sessionKey: string,
  ): Promise<RelatedFile[]> {
    try {
      const params = new URLSearchParams({
        root: rootId,
      });
      const data = await protectedJSON<any[]>(
        appURL(
          `/api/sessions/${encodeURIComponent(sessionKey)}/related-files`,
          params,
        ),
      );
      return Array.isArray(data) ? (data as RelatedFile[]) : [];
    } catch (err) {
      console.error("[Session] Failed to get session related files:", err);
      return [];
    }
  }

  async removeSessionRelatedFile(
    rootId: string,
    sessionKey: string,
    path: string,
    head = "",
    repoPath = "",
    repoKind = "",
  ): Promise<boolean> {
    try {
      const params = new URLSearchParams({ root: rootId, path });
      if (head) {
        params.set("head", head);
      }
      if (repoPath) {
        params.set("repo_path", repoPath);
      }
      if (repoKind) {
        params.set("repo_kind", repoKind);
      }
      const res = await protectedFetch(
        appURL(
          `/api/sessions/${encodeURIComponent(sessionKey)}/related-files`,
          params,
        ),
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error("Failed to remove session related file");
      }
      return true;
    } catch (err) {
      console.error("[Session] Failed to remove session related file:", err);
      return false;
    }
  }

  async deleteSession(rootId: string, sessionKey: string): Promise<boolean> {
    try {
      const params = new URLSearchParams({ root: rootId });
      const res = await protectedFetch(
        appURL(`/api/sessions/${encodeURIComponent(sessionKey)}`, params),
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error("Failed to delete session");
      }
      return true;
    } catch (err) {
      console.error("[Session] Failed to delete session:", err);
      return false;
    }
  }

  async renameSession(
    rootId: string,
    sessionKey: string,
    name: string,
  ): Promise<Session | null> {
    try {
      const params = new URLSearchParams({ root: rootId });
      const data = await protectedJSON<Session>(
        appURL(
          `/api/sessions/${encodeURIComponent(sessionKey)}/rename`,
          params,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name }),
        },
      );
      return data as Session;
    } catch (err) {
      console.error("[Session] Failed to rename session:", err);
      return null;
    }
  }

  async setSessionPinned(
    rootId: string,
    sessionKey: string,
    pinned: boolean,
  ): Promise<Session | null> {
    try {
      const params = new URLSearchParams({ root: rootId });
      const data = await protectedJSON<Session>(
        appURL(
          `/api/sessions/${encodeURIComponent(sessionKey)}/pin`,
          params,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pinned }),
        },
      );
      return data as Session;
    } catch (err) {
      console.error("[Session] Failed to update session pin:", err);
      return null;
    }
  }

  async forkSession(
    rootId: string,
    sessionKey: string,
    seq: number,
  ): Promise<{ session_key: string; session?: Session } | null> {
    try {
      if (!rootId || !sessionKey || !seq) {
        return null;
      }
      return await protectedJSON<{ session_key: string; session?: Session }>(
        appURL("/api/sessions/fork"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            root_id: rootId,
            session_key: sessionKey,
            seq,
          }),
        },
      );
    } catch (err) {
      console.error("[Session] Failed to fork session:", err);
      return null;
    }
  }

  async fetchExternalSessions(
    rootId: string,
    agent: string,
    options?: FetchExternalSessionsOptions,
  ): Promise<Session[]> {
    if (!rootId || !agent) {
      return [];
    }
    const params = new URLSearchParams({ root: rootId, agent });
    if (options?.beforeTime) {
      params.set("before_time", options.beforeTime);
    }
    if (options?.afterTime) {
      params.set("after_time", options.afterTime);
    }
    if (options?.filterBound) {
      params.set("filter_bound", "true");
    }
    if (typeof options?.limit === "number" && options.limit > 0) {
      params.set("limit", String(options.limit));
    }
    const data = await protectedJSON<any[]>(appURL("/api/sessions/external", params));
    return Array.isArray(data) ? data : [];
  }

  async importExternalSession(
    rootId: string,
    agent: string,
    agentSessionId: string,
  ): Promise<{ session_key: string } | null> {
    try {
      return await protectedJSON<{ session_key: string }>(appURL("/api/sessions/import"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          root_id: rootId,
          agent,
          agent_session_id: agentSessionId,
        }),
      });
    } catch (err) {
      console.error("[Session] Failed to import external session:", err);
      return null;
    }
  }

  async importExternalSessionsBatch(
    rootId: string,
    agent: string,
    agentSessionIds: string[],
  ): Promise<{
    items: Array<{
      agent_session_id: string;
      session_key?: string;
      imported_count?: number;
      success: boolean;
      error?: string;
      error_code?: string;
      error_detail?: string;
      error_path?: string;
      error_operation?: string;
    }>;
  } | null> {
    try {
      return await protectedJSON(appURL("/api/sessions/import/batch"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          root_id: rootId,
          agent,
          agent_session_ids: agentSessionIds,
        }),
      });
    } catch (err) {
      console.error("[Session] Failed to import external sessions:", err);
      return null;
    }
  }
}

export const sessionService = new SessionService();

export async function syncSession(
  rootId: string,
  sessionKey: string,
  options?: { full?: boolean },
): Promise<SyncSessionResult> {
  const base = await getCachedSession(rootId, sessionKey);
  const seq = getSessionMaxSeq(base);
  const reconcileHistory = options?.full || !hasCurrentActivityHistory(base) || base?.reply_metadata_version !== 1;
  let incoming = reconcileHistory
    ? await sessionService.syncExternalSession(rootId, sessionKey, 0)
    : await sessionService.getSession(rootId, sessionKey, seq);
  const historyReconciled = reconcileHistory && hasCurrentActivityHistory(incoming);
  // An unavailable native file must not hide already saved server history.
  if (!incoming && reconcileHistory) {
    incoming = await sessionService.getSession(rootId, sessionKey, seq);
  }
  if (!incoming) {
    return { session: base, hasDelta: false };
  }
  const incomingExchanges = Array.isArray(incoming.exchanges)
    ? incoming.exchanges
    : [];
  const persistedDelta = incomingExchanges.filter((exchange) => {
    const exchangeSeq = Number((exchange as any)?.seq || 0);
    return Number.isFinite(exchangeSeq) && exchangeSeq > 0;
  });
  const transientTail = incomingExchanges.filter(
    (exchange) => Number((exchange as any)?.seq || 0) === 0,
  );
  const persistedSession = appendSessionDelta(base, {
    ...incoming,
    key: sessionKey,
    activity_history_version: historyReconciled ? ACTIVITY_HISTORY_VERSION : base?.activity_history_version,
    reply_metadata_version: reconcileHistory && incoming.reply_metadata_version === 1 ? 1 : base?.reply_metadata_version,
    exchanges: persistedDelta,
    exchange_aux: toPersistentExchangeAux(incoming.exchange_aux),
  });
  if (!persistedSession) {
    return { session: null, hasDelta: false };
  }
  await saveCachedSession(rootId, persistedSession);
  const displaySession = withSessionMeta(persistedSession, {
    ...incoming,
    key: sessionKey,
    exchanges: [...(persistedSession.exchanges || []), ...transientTail],
    exchange_aux: persistedSession.exchange_aux,
  });
  return {
    session: displaySession ? cloneSession(displaySession) : null,
    hasDelta: persistedDelta.length > 0 || Object.keys(incoming.exchange_aux || {}).length > 0,
  };
}
