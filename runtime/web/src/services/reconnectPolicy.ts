/**
 * Timing rules for the page's WebSocket. Kept apart from the socket code so the numbers can be
 * checked on their own: a connection that is slow is not a connection that is dead, and a page
 * that retries every few seconds against a slow path only adds load to the path it is waiting on.
 */
export const RECONNECT_POLICY = {
  /** Wait before the Nth consecutive retry; the last entry repeats. */
  backoffMs: [1000, 2000, 4000, 8000, 15000, 30000],
  /** Retries after the first are spread by up to ±this fraction so many pages do not retry in step. */
  jitter: 0.2,
  /** A connection that stays open this long was healthy: the failure count starts over. */
  healthyAfterMs: 10_000,
  /** How long an attempt may take to open; each consecutive failure allows longer (the last repeats). */
  connectTimeoutMs: [5000, 8000, 12_000, 20_000],
  /** Probe only a connection that has been silent this long (any inbound message counts as alive). */
  probeIdleMs: 15_000,
  /** How long a probe may wait for any reply on an idle connection. */
  probeTimeoutMs: 10_000,
  /** Shorter wait right after the page returns to the foreground or the network comes back. */
  wakeProbeTimeoutMs: 5000,
  /** Focus, pageshow, visibility and online arrive together; act on the first one only. */
  wakeCooldownMs: 3000,
} as const;

function at<T>(values: readonly T[], index: number): T {
  return values[Math.min(Math.max(index, 0), values.length - 1)];
}

/** Delay before retry number `failures` (1 = the first retry after a failure). */
export function retryDelayMs(failures: number, random: () => number = Math.random): number {
  const base = at(RECONNECT_POLICY.backoffMs, failures - 1);
  if (failures <= 1) return base; // the first retry stays prompt and predictable
  const spread = (random() * 2 - 1) * RECONNECT_POLICY.jitter;
  return Math.round(base * (1 + spread));
}

/** How long attempt number `failures + 1` may take to open. */
export function connectTimeoutMs(failures: number): number {
  return at(RECONNECT_POLICY.connectTimeoutMs, failures);
}
