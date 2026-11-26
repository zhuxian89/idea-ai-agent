import type { AgentStatus } from "./agents";

export function nativePermissionChoices(agent?: AgentStatus | null) {
  const protocol = agent?.protocol || (agent?.name === "codex" ? "codex-sdk" : agent?.name === "claude" ? "claude-sdk" : "");
  if (protocol === "codex-sdk") return [
    {id: "full-access", label: "full-access"},
    {id: "default", label: "default"},
    {id: "read-only", label: "read-only"},
  ] as const;
  if (protocol === "claude-sdk") return [
    {id: "bypassPermissions", label: "bypassPermissions"},
    {id: "default", label: "default"},
    {id: "acceptEdits", label: "acceptEdits"},
  ] as const;
  return [];
}
