import { useCallback, useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { activityDisclosure, activityDisclosureKey } from "../services/activityDisclosure";

export function useActivityDisclosure({ rootId, sessionKey, callId, localKey, groupKey, defaultExpanded }: {
  rootId?: string | null; sessionKey?: string | null; callId: string; localKey?: string; groupKey?: string; defaultExpanded: boolean;
}) {
  const fallbackKey = useId();
  const ref = useMemo(() => ({ rootId: rootId || "", sessionKey: sessionKey || "",
    itemKey: activityDisclosureKey({ callId, localKey: localKey || fallbackKey, groupKey }),
  }), [rootId, sessionKey, callId, localKey, groupKey, fallbackKey]);
  const read = useCallback(() => activityDisclosure.get(ref), [ref]);
  const choice = useSyncExternalStore(activityDisclosure.subscribe, read, read);
  const releaseFocus = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    activityDisclosure.touch(ref);
    return () => { releaseFocus.current?.(); releaseFocus.current = undefined; };
  }, [ref]);
  const expanded = choice ? choice === "open" : defaultExpanded;
  return {
    expanded,
    toggle: () => activityDisclosure.set(ref, expanded ? "closed" : "open"),
    focusProps: {
      onFocusCapture: () => { releaseFocus.current?.(); releaseFocus.current = activityDisclosure.focus(ref); },
      onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          releaseFocus.current?.();
          releaseFocus.current = undefined;
        }
      },
    },
  };
}
