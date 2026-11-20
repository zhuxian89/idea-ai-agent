import { protectedJSON } from "./api";
import { appPath } from "./base";

/** 独立后台在页面里更新自己：GET 读状态，POST 触发。旧版后台和内置后台没有这个接口（404）。 */
export type UpdateStatus = {
  supported: boolean;
  phase: "idle" | "installing" | "done" | "failed";
  current: string;
  target?: string;
  error?: string;
  log?: string;
};

let updatingUntil = 0;

export function standaloneUpdateInProgress(): boolean {
  return Date.now() < updatingUntil;
}

export async function fetchUpdateStatus(): Promise<UpdateStatus> {
  const status = await protectedJSON<UpdateStatus>(appPath("/api/standalone/update"), { cache: "no-store" });
  if (status.phase === "installing") updatingUntil = Date.now() + RECONNECT_LIMIT_MS;
  if (status.phase === "done" || status.phase === "failed") updatingUntil = 0;
  return status;
}

export async function startUpdate(version: string): Promise<UpdateStatus> {
  updatingUntil = Date.now() + RECONNECT_LIMIT_MS;
  try {
    return await protectedJSON<UpdateStatus>(appPath("/api/standalone/update"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
  } catch (error) {
    updatingUntil = 0;
    throw error;
  }
}

/** 后台重启期间页面连不上；超过这个时间还连不上就按失败处理，提示用户去那台电脑上查看。 */
export const RECONNECT_LIMIT_MS = 5 * 60_000;
export const POLL_MS = 2_000;
/** 更新完成后留一会儿显示结果，再刷新页面加载新版网页。 */
export const RELOAD_AFTER_MS = 2_500;

export type UpdateStep = "unknown" | "idle" | "installing" | "reconnecting" | "done" | "failed";
export type UpdateUi = {
  step: UpdateStep;
  /** 接口存在。旧版后台、内置后台没有，页面只显示“查看新版”链接。 */
  supported: boolean;
  target: string;
  error: string;
  log: string;
  /** 第一次连不上的时间，用来判断超时。 */
  lostAt: number;
};

export const initialUpdateUi: UpdateUi = { step: "unknown", supported: false, target: "", error: "", log: "", lostAt: 0 };

export type UpdateEvent =
  | { type: "status"; status: UpdateStatus; pageVersion?: string }
  | { type: "unsupported" }
  | { type: "unreachable"; at: number }
  | { type: "startFailed"; error: string };

/** 页面上的更新状态机，纯函数，方便测试。 */
export function nextUpdateUi(ui: UpdateUi, event: UpdateEvent): UpdateUi {
  switch (event.type) {
    case "unsupported":
      return { ...initialUpdateUi, step: "idle" };
    case "status": {
      const { status } = event;
      const base = { ...ui, supported: true, target: status.target || ui.target, lostAt: 0 };
      switch (status.phase) {
        case "installing": return { ...base, step: "installing", error: "", log: "" };
        case "done": return { ...base, step: event.pageVersion === status.current ? "idle" : "done", error: "", log: "" };
        case "failed": return { ...base, step: "failed", error: status.error || "", log: status.log || "" };
        default: return { ...base, step: "idle", error: "", log: "" };
      }
    }
    case "unreachable": {
      if (ui.step !== "installing" && ui.step !== "reconnecting") return ui;
      const lostAt = ui.lostAt || event.at;
      if (event.at - lostAt > RECONNECT_LIMIT_MS) {
        return { ...ui, step: "failed", lostAt, error: "reconnect_timeout", log: "" };
      }
      return { ...ui, step: "reconnecting", lostAt };
    }
    case "startFailed":
      return { ...ui, step: "failed", error: event.error, log: "", lostAt: 0 };
  }
}
