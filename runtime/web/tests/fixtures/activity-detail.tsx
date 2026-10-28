import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionActivity } from "../../src/components/SessionActivity";
import { I18nProvider } from "../../src/i18n";
import { sessionService } from "../../src/services/session";
import "../../src/index.css";

const user = { id: "user", type: "user_text" as const, content: "Test", timestamp: new Date().toISOString() };
const plan = { id: "plan", type: "todo" as const, todoUpdate: { items: [{ content: "补充回归测试并验证旧库升级兼容性", status: "in_progress" }] } };
const tool = { id: "tool", type: "tool" as const, toolCall: { callId: "tool", kind: "execute", title: "", status: "running", meta: { command: "echo first && echo second" } } };
function Fixture() {
  const [props, setProps] = useState<any>({ timeline: [user, plan, tool], connected: true, recoveryText: "", lastEventAt: Date.now(), active: true, rootId: "root", sessionKey: "session" });
  const show = (items: any[]) => setProps((old: any) => ({ ...old, connected: true, recoveryText: "", timeline: [user, ...items], lastEventAt: Date.now() }));
  return <I18nProvider><main style={{ padding: 12 }}>
    <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => show([plan, tool])}>计划与脚本</button>
      <button onClick={() => show([plan, { ...tool, toolCall: { ...tool.toolCall, meta: { description: "检查 template_snapshot_json 旧库迁移兼容性" } } }])}>工具说明</button>
      <button onClick={() => show([plan])}>仅计划</button>
      <button onClick={() => show([plan, { ...plan, id: "finished", todoUpdate: { items: [{ content: "补充回归测试", status: "completed" }] } }])}>计划完成</button>
      <button onClick={() => show([tool])}>无具体信息</button>
      <button onClick={() => show([])}>无信息</button>
      <button onClick={() => show([plan, { ...tool, toolCall: { ...tool.toolCall, kind: "ask_user" } }])}>等待回答</button>
      <button onClick={() => setProps((old: any) => ({ ...old, connected: false }))}>断开</button>
      <button onClick={() => setProps((old: any) => ({ ...old, recoveryText: "正在恢复会话" }))}>恢复中</button>
      <button onClick={() => sessionService.handleMessage({ type: "session.done", payload: { root_id: "root", session_key: "session" } } as any)}>执行完成</button>
    </nav>
    <SessionActivity {...props} />
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
