import type { SlashCommandResult } from "./sessionModel";

export function slashCommandResultForSession(
slashCommandResults: Record<string, SlashCommandResult>,
rootSessionKey: (rootId: string, sessionKey: string) => string,
rootID: string | null | undefined,
session: { key?: string; session_key?: string } | null | undefined,
): SlashCommandResult | null {
  const sessionKey = session?.key || session?.session_key || "";
  const resolvedRoot = rootID || "";
  if (!resolvedRoot) {
    return null;
  }
  if (!sessionKey) {
    let best: SlashCommandResult | null = null;
    for (const value of Object.values(slashCommandResults)) {
      if (
        value.rootId !== resolvedRoot ||
        !value.sessionKey.startsWith("transient-")
      ) {
        continue;
      }
      if (!best || (value.createdAt || 0) > (best.createdAt || 0)) {
        best = value;
      }
    }
    return best;
  }
  return (
    slashCommandResults[rootSessionKey(resolvedRoot, sessionKey)] || null
  );
}
