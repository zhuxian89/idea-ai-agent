import { protectedJSON } from "./api";
import { appPath } from "./base";

/** 运行后台的这台电脑的负载，来自 GET /api/system/stats。 */
export type SystemStats = {
  host: string;
  cpu_percent: number;
  cpu_cores: number;
  mem_percent: number;
  mem_used: number;
  mem_total: number;
  sampled_at_ms: number;
};

export type LoadLevel = "ok" | "warn" | "crit";
export type HistoryPoint = { t: number; v: number };

export const WARN_AT = 70;
export const CRIT_AT = 90;
/** 走势只画最近一分钟。 */
export const HISTORY_WINDOW_MS = 60_000;
/** 详情展开时每 2 秒读一次，只显示收起的卡片时放慢。 */
export const EXPANDED_POLL_MS = 2_000;
export const COLLAPSED_POLL_MS = 5_000;
/** 读取失败后（旧版后台没有这个接口，或公网暂时不通）隔多久再试。 */
export const RETRY_MS = 30_000;

/** 受保护的接口在页面刚打开时还没就绪，这不是失败，稍后再试即可。 */
export const NOT_READY_RETRY_MS = 1_000;

/** 读取失败后多久再试：接口尚未就绪很快重试，其他失败（旧版后台、公网不通）放慢。 */
export function retryDelay(error: unknown): { delay: number; failed: boolean } {
  if (error instanceof Error && error.message === "api_not_ready") return { delay: NOT_READY_RETRY_MS, failed: false };
  return { delay: RETRY_MS, failed: true };
}

export function loadLevel(percent: number): LoadLevel {
  if (percent >= CRIT_AT) return "crit";
  if (percent >= WARN_AT) return "warn";
  return "ok";
}

export function pollDelay(expanded: boolean): number {
  return expanded ? EXPANDED_POLL_MS : COLLAPSED_POLL_MS;
}

/** 追加一个点，并丢掉超出时间窗口的旧点。不修改原数组。 */
export function pushHistory(history: HistoryPoint[], point: HistoryPoint, windowMs = HISTORY_WINDOW_MS): HistoryPoint[] {
  return [...history, point].filter((item) => point.t - item.t <= windowMs);
}

/** 内存以 GB（1024³ 字节）显示，与系统自带的监视器一致。 */
export function formatGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

/**
 * 走势的折线和面积路径。横轴是真实时间：窗口内点少（收起时 5 秒一个点）也按各自的时间放置，
 * 不把稀疏的点拉伸成一整分钟。纵轴 0 到 100%。
 */
export function sparkPaths(points: HistoryPoint[], now: number, width: number, height: number, windowMs = HISTORY_WINDOW_MS): { line: string; area: string } {
  const visible = points.filter((item) => now - item.t <= windowMs);
  if (visible.length === 0) return { line: "", area: "" };
  const pad = 3;
  const coords = visible.map((item) => {
    const x = Math.max(0, Math.min(width, ((item.t - (now - windowMs)) / windowMs) * width));
    const y = height - pad - (Math.max(0, Math.min(100, item.v)) / 100) * (height - pad * 2);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });
  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  return { line, area: `${line} L${last[0]} ${height} L${first[0]} ${height} Z` };
}

export function fetchSystemStats(): Promise<SystemStats> {
  return protectedJSON<SystemStats>(appPath("/api/system/stats"));
}
