import React, { useCallback, useEffect, useRef, useState } from "react";

export type SessionTabItem = {
  key: string;
  label: string;
  pending?: boolean;
};

type SessionTabsProps = {
  tabs: SessionTabItem[];
  activeKey?: string;
  ariaLabel: string;
  previousLabel: string;
  nextLabel: string;
  closeLabel: (label: string) => string;
  runningLabel: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
};

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "m10 3-5 5 5 5" : "m6 3 5 5-5 5"} />
    </svg>
  );
}

export function SessionTabs({
  tabs,
  activeKey = "",
  ariaLabel,
  previousLabel,
  nextLabel,
  closeLabel,
  runningLabel,
  onSelect,
  onClose,
}: SessionTabsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const updateOverflow = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const max = Math.max(0, node.scrollWidth - node.clientWidth);
    setOverflow({
      left: node.scrollLeft > 1,
      right: node.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    updateOverflow();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateOverflow);
    observer?.observe(node);
    node.addEventListener("scroll", updateOverflow, { passive: true });
    return () => {
      observer?.disconnect();
      node.removeEventListener("scroll", updateOverflow);
    };
  }, [tabs.length, updateOverflow]);

  useEffect(() => {
    if (!activeKey) return;
    const frame = requestAnimationFrame(() => {
      tabRefs.current[activeKey]?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "auto",
      });
      updateOverflow();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeKey, updateOverflow]);

  const moveFocus = (fromKey: string, direction: -1 | 1 | "first" | "last") => {
    if (!tabs.length) return;
    const current = Math.max(0, tabs.findIndex((tab) => tab.key === fromKey));
    const index = direction === "first"
      ? 0
      : direction === "last"
        ? tabs.length - 1
        : (current + direction + tabs.length) % tabs.length;
    const target = tabs[index];
    tabRefs.current[target.key]?.focus();
    onSelect(target.key);
  };

  const scroll = (direction: -1 | 1) => {
    scrollerRef.current?.scrollBy({
      left: direction * Math.max(140, scrollerRef.current.clientWidth * 0.65),
      behavior: "smooth",
    });
  };

  if (!tabs.length) return null;

  return (
    <div className="idea-session-tabs-shell">
      <div className="idea-session-tabs-region">
        {overflow.left ? (
          <button
            type="button"
            className="idea-session-tabs-scroll idea-session-tabs-scroll-left"
            aria-label={previousLabel}
            onClick={() => scroll(-1)}
          >
            <Chevron direction="left" />
          </button>
        ) : null}
        <div
          ref={scrollerRef}
          className="idea-session-tabs"
          role="tablist"
          aria-label={ariaLabel}
        >
          {tabs.map((tab) => {
            const active = tab.key === activeKey;
            return (
              <div
                key={tab.key}
                className="idea-session-tab"
                data-active={active ? "true" : undefined}
                data-pending={tab.pending ? "true" : undefined}
              >
                <button
                  ref={(node) => { tabRefs.current[tab.key] = node; }}
                  type="button"
                  className="idea-session-tab-main"
                  role="tab"
                  aria-selected={active}
                  aria-controls="idea-active-session-panel"
                  tabIndex={active || (!activeKey && tab === tabs[0]) ? 0 : -1}
                  title={tab.label}
                  onClick={() => onSelect(tab.key)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      event.preventDefault();
                      moveFocus(tab.key, event.key === "ArrowLeft" ? -1 : 1);
                    } else if (event.key === "Home" || event.key === "End") {
                      event.preventDefault();
                      moveFocus(tab.key, event.key === "Home" ? "first" : "last");
                    }
                  }}
                >
                  {tab.pending ? (
                    <span
                      className="idea-session-tab-pulse"
                      aria-label={runningLabel}
                      title={runningLabel}
                    />
                  ) : null}
                  <span className="idea-session-tab-label">{tab.label}</span>
                </button>
                <button
                  type="button"
                  className="idea-session-tab-close"
                  aria-label={closeLabel(tab.label)}
                  title={closeLabel(tab.label)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.key);
                  }}
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="m3 3 6 6M9 3 3 9" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        {overflow.right ? (
          <button
            type="button"
            className="idea-session-tabs-scroll idea-session-tabs-scroll-right"
            aria-label={nextLabel}
            onClick={() => scroll(1)}
          >
            <Chevron direction="right" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
