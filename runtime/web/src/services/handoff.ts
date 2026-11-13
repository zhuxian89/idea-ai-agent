export const HANDOFF_TEMPLATE_STORAGE_KEY = "mindfs-handoff-template";

export const HANDOFF_AGENT_ID_FALLBACK = "（无）";

// 模板有意保持中文：接力包的读者是主人手下的 AI 代理（工作语言中文），
// 且模板是用户数据存 localStorage，随界面语言切换会造成同值双语混乱
export const DEFAULT_HANDOFF_TEMPLATE = [
  "【会话接力】接手以下会话，继续未完成的任务。",
  "1. 会话源文件（JSONL，每行一条消息；文件可能很大，先用 tail 读最后 20 行，不够再每次往前读约 20 行）：",
  "   {jsonl_path}",
  "2. 会话 ID：{session_key}",
  "3. 原生 Agent 会话 ID：{agent_session_id}（用于相同 Agent 的恢复；没有 ID 时忽略本条）",
  "请先复述你对任务的理解，然后继续执行。",
].join("\n");

export type HandoffContext = {
  sessionKey: string;
  jsonlPath: string;
  agentSessionId: string;
};

export function loadHandoffTemplate(): string {
  if (typeof window === "undefined") {
    return DEFAULT_HANDOFF_TEMPLATE;
  }
  try {
    const stored = window.localStorage.getItem(HANDOFF_TEMPLATE_STORAGE_KEY);
    if (typeof stored === "string" && stored.includes("{jsonl_path}")) {
      return stored;
    }
    return DEFAULT_HANDOFF_TEMPLATE;
  } catch {
    return DEFAULT_HANDOFF_TEMPLATE;
  }
}

export function persistHandoffTemplate(template: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(HANDOFF_TEMPLATE_STORAGE_KEY, template);
}

export function renderHandoffPack(template: string, context: HandoffContext): string {
  return template
    .split("{jsonl_path}").join(context.jsonlPath)
    .split("{session_key}").join(context.sessionKey)
    .split("{agent_session_id}").join(context.agentSessionId || HANDOFF_AGENT_ID_FALLBACK);
}
