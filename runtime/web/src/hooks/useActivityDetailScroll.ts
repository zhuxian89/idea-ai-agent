import { useCallback, useLayoutEffect, useRef } from "react";

export function useActivityDetailScroll(identity: string, expanded: boolean, content: unknown) {
  const detailScrollRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  useLayoutEffect(() => { stick.current = true; }, [identity, expanded]);
  const followOutput = useCallback(() => {
    const el = detailScrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(followOutput, [followOutput, identity, expanded, content]);
  const onScroll = () => {
    const el = detailScrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  return { detailScrollRef, onScroll, followOutput };
}
