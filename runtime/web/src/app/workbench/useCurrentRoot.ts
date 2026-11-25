import { useState, useRef, useEffect, useCallback } from "react";
import { projectStorage } from "../../services/remoteScope";
import { LAST_ROOT_STORAGE_KEY } from "../storagePrefs";
import { URLState } from "../runtimeTypes";
import { buildURLSearch } from "../urlState";
import { isRemoteWebUi } from "../../services/remoteUi";

export function useCurrentRoot() {
  const [currentRootId, setCurrentRootId] = useState<string | null>(null);
  const currentRootIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentRootIdRef.current = currentRootId;
  }, [currentRootId]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (currentRootId) {
      projectStorage().setItem(LAST_ROOT_STORAGE_KEY, currentRootId);
    }
  }, [currentRootId]);
  const replaceURLState = useCallback((next: URLState) => {
    const search = new URLSearchParams(buildURLSearch(next));
    const deviceOverride = new URLSearchParams(location.search).get("device");
    if (isRemoteWebUi && deviceOverride) search.set("device", deviceOverride);
    const params = search.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${params ? `?${params}` : ""}`);
  }, []);

  return { currentRootId, currentRootIdRef, replaceURLState, setCurrentRootId };
}
