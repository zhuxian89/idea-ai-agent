import type { AgentStatus } from "./agents";

export function nativePermissionChoices(agent?: AgentStatus | null) {
  const protocol = agent?.protocol || (agent?.name === "codex" ? "codex-sdk" : agent?.name === "claude" ? "claude-sdk" : "");
  if (protocol === "codex-sdk") return [
    {id: "full-access", label: "permission.full"},
    {id: "default", label: "permission.standard"},
    {id: "read-only", label: "permission.readOnly"},
  ] as const;
  if (protocol === "claude-sdk") return [
    {id: "bypassPermissions", label: "permission.full"},
    {id: "default", label: "permission.standard"},
    {id: "acceptEdits", label: "permission.acceptEdits"},
  ] as const;
  return [];
}
