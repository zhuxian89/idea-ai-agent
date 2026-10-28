import type { ActivityOperation } from "./activityFacts";

// Use the shared, structured operation. Tool names, command text and output do
// not prove that a build, deployment or business test has succeeded.
export function toolReaction(operation: ActivityOperation) {
  if (operation === "execute") {
    return { emoji: "🔥", key: "session.activityExecuting" } as const;
  }
  if (operation === "web_search" || operation === "fetch") {
    return { emoji: "⚡", key: "session.activityWeb" } as const;
  }
  if (["read", "list", "search", "file_change"].includes(operation)) {
    return { emoji: "👨‍💻", key: "session.activityCoding" } as const;
  }
  return { emoji: "🔥", key: "session.activityWorking" } as const;
}
