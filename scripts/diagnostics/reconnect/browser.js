(() => {
  const script = document.currentScript;
  const endpoint = new URL('__connection_observer', script.src).href;
  const storageKey = 'local-ai-connection-observer';
  const queueLimit = 2000;
  const page = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let queue = [], sequence = 0, socketSequence = 0, posting = false;
  let lastTick = performance.now(), loopLag = 0, lagAt = 0;
  const NativeWebSocket = window.WebSocket;

  // Retain failed-connection evidence across the refresh that may recover it.
  try { queue = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); } catch { queue = []; }
  if (!Array.isArray(queue)) queue = [];
  function persist() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(queue.slice(-queueLimit))); } catch {}
  }
  function record(event) {
    queue.push({ page, seq: ++sequence, at: Date.now(), mono: Math.round(performance.now()), hidden: document.hidden, ...event });
    if (queue.length > queueLimit) queue.splice(0, queue.length - queueLimit);
  }
  async function flush() {
    if (posting || !queue.length) return;
    posting = true;
    const batch = queue.slice(0, 30);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch), keepalive: true, signal: controller.signal,
      });
      if (response.ok) {
        const accepted = new Set(batch.map(e => `${e.page}:${e.seq}`));
        queue = queue.filter(e => !accepted.has(`${e.page}:${e.seq}`));
        persist();
      }
    } catch { persist(); } finally { clearTimeout(timeout); posting = false; }
  }
  function heartbeat(data) {
    if (typeof data !== 'string' || data.length > 512) return null;
    try {
      const value = JSON.parse(data);
      return (value.type === 'ping' || value.type === 'pong') && typeof value.id === 'string'
        ? { kind: value.type, probe: value.id.slice(0, 100) } : null;
    } catch { return null; }
  }
  window.WebSocket = class extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      const url = new URL(String(args[0]), location.href);
      this.observer = { socket: ++socketSequence, client: (url.searchParams.get('client_id') || '').slice(0, 100) };
      this.observerActive = /\/ws$/.test(url.pathname);
      this.observerLastReceive = performance.now();
      this.observerProbe = null;
      if (!this.observerActive) return;
      record({ ...this.observer, kind: 'opening' });
      this.addEventListener('open', () => { record({ ...this.observer, kind: 'open' }); void flush(); });
      this.addEventListener('message', event => {
        const now = performance.now();
        const message = heartbeat(event.data);
        if (message?.kind === 'pong') record({ ...this.observer, ...message,
          age_ms: this.observerProbe?.id === message.probe ? Math.round(now - this.observerProbe.at) : -1 });
        this.observerLastReceive = now;
        this.observerProbe = null;
      });
      this.addEventListener('close', event => {
        record({ ...this.observer, kind: 'closed', code: event.code, clean: event.wasClean, ...this.observerSnapshot() });
        persist(); void flush();
      });
      this.addEventListener('error', () => { record({ ...this.observer, kind: 'error', ...this.observerSnapshot() }); persist(); });
    }
    observerSnapshot() {
      const now = performance.now();
      return { probe: this.observerProbe?.id || '', age_ms: this.observerProbe ? Math.round(now - this.observerProbe.at) : -1,
        rx_gap_ms: Math.round(now - this.observerLastReceive), buffered: this.bufferedAmount,
        lag_ms: Math.max(now - lagAt < 10000 ? loopLag : 0, Math.round(now - lastTick - 1000), 0),
        hidden: document.hidden, state: this.readyState };
    }
    send(data) {
      super.send(data);
      if (!this.observerActive) return;
      const message = heartbeat(data);
      if (message?.kind === 'ping') {
        this.observerProbe = { id: message.probe, at: performance.now() };
        record({ ...this.observer, ...message, ...this.observerSnapshot() });
      }
    }
    close(...args) {
      if (this.observerActive) {
        record({ ...this.observer, kind: 'client_close', code: args[0] || 0, ...this.observerSnapshot() });
        persist(); void flush();
      }
      return super.close(...args);
    }
  };
  setInterval(() => {
    const now = performance.now();
    const delay = Math.max(0, Math.round(now - lastTick - 1000));
    if (delay > 250) {
      loopLag = delay; lagAt = now;
      record({ kind: 'event_loop_delay', lag_ms: delay, hidden: document.hidden });
    }
    lastTick = now;
  }, 1000);
  setInterval(() => void flush(), 10000);
  document.addEventListener('visibilitychange', () => record({ kind: 'visibility', hidden: document.hidden }));
  window.addEventListener('pagehide', () => { record({ kind: 'pagehide' }); persist(); void flush(); });
  record({ kind: 'observer_loaded', hidden: document.hidden });
  void flush();
})();
