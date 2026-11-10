import type { ActivityOperation } from "./activityFacts";

// Use the shared, structured operation. Tool names, command text and output do
// not prove that a build, deployment or business test has succeeded. Only the
// wording differs between read-only and writing operations; the emoji stay put.
export function toolReaction(operation: ActivityOperation) {
  if (operation === "execute") {
    return { emoji: "🔥", key: "session.activityExecuting" } as const;
  }
  if (operation === "web_search" || operation === "fetch") {
    return { emoji: "⚡", key: "session.activityWeb" } as const;
  }
  if (operation === "read" || operation === "list") {
    return { emoji: "👨‍💻", key: "session.activityReading" } as const;
  }
  if (operation === "search") {
    return { emoji: "👨‍💻", key: "session.activitySearching" } as const;
  }
  if (operation === "file_change") {
    return { emoji: "👨‍💻", key: "session.activityEditing" } as const;
  }
  if (operation === "mcp") {
    return { emoji: "🔥", key: "session.activityMcp" } as const;
  }
  if (operation === "task") {
    return { emoji: "🔥", key: "session.activitySubagent" } as const;
  }
  return { emoji: "🔥", key: "session.activityWorking" } as const;
}
