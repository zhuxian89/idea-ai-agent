import React from "react";
import type { useFileTreeMenuBehavior } from "./useFileTreeMenuBehavior";

type Deps = {
  fileTreeMenuBehaviorApi: ReturnType<typeof useFileTreeMenuBehavior>;
};

export function useRelayServices({ fileTreeMenuBehaviorApi }: Deps) {
  const { inPhoneMore } = fileTreeMenuBehaviorApi;

  const [relayServicesOpen, setRelayServicesOpen] = React.useState(false);
  const [relayServicesEditing, setRelayServicesEditing] = React.useState(false);
  const relayServicesPopoverRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (inPhoneMore || !relayServicesOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (relayServicesEditing) {
        return;
      }
      if (!relayServicesPopoverRef.current?.contains(event.target as Node)) {
        setRelayServicesOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [inPhoneMore, relayServicesEditing, relayServicesOpen]);
  const closeRelayServices = React.useCallback(() => {
    setRelayServicesOpen(false);
    setRelayServicesEditing(false);
  }, []);

  return { closeRelayServices, relayServicesOpen, relayServicesPopoverRef, setRelayServicesEditing, setRelayServicesOpen };
}
