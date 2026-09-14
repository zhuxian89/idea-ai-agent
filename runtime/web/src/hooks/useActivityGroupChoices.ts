import { useEffect, useSyncExternalStore } from "react";
import { activityDisclosure, activityDisclosureKey } from "../services/activityDisclosure";
import type { ActivityGroup } from "../services/activityGrouping";

export function useActivityGroupChoices(groups: readonly ActivityGroup[], scope: { rootId: string; sessionKey: string }) {
  useSyncExternalStore(activityDisclosure.subscribe, activityDisclosure.getRevision, activityDisclosure.getRevision);
  const choices = groups.map(group => {
    const ref = { ...scope, itemKey: activityDisclosureKey({ groupKey: group.key }) };
    const choice = activityDisclosure.get(ref);
    let hasOpenChild = false;
    let hasFocusedChild = false;
    for (const item of group.items) {
      const child = { ...scope, itemKey: activityDisclosureKey({ callId: item.ref!.callId }) };
      hasOpenChild ||= activityDisclosure.get(child) === "open";
      hasFocusedChild ||= activityDisclosure.isFocused(child);
    }
    const expanded = hasFocusedChild || choice === "open" || (choice === undefined && hasOpenChild);
    return { key: group.key, ref, expanded, inheritOpen: choice === undefined && (hasOpenChild || hasFocusedChild),
      toggle: () => activityDisclosure.set(ref, expanded ? "closed" : "open") };
  });
  useEffect(() => {
    // A new group inherits the user's existing reading choice once. Leaving
    // focus or closing that child later must not suddenly collapse the group.
    for (const state of choices) if (state.inheritOpen) activityDisclosure.set(state.ref, "open");
  }, [choices]);
  return new Map(choices.map(state => [state.key, state]));
}
