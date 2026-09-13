import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type PermissionSelectorProps = {
  value: string;
  choices: readonly { id: string; label: string }[];
  label: string;
  description?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function PermissionSelector({ value, choices, label, description, disabled = false, onChange }: PermissionSelectorProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 168, maxHeight: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = choices.find((choice) => choice.id === value);
  const options = selected ? choices : [{ id: value, label: value }, ...choices];

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(168, rect.width), window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 6,
        width,
        maxHeight: Math.max(0, rect.top - 14),
      });
    };
    updatePosition();
    (menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ||
      menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, disabled]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const closeAndFocus = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return <>
    <button
      ref={buttonRef}
      type="button"
      className="idea-permission-select"
      aria-label={`${label}: ${selected?.label || value}`}
      aria-haspopup="listbox"
      aria-expanded={open && !disabled}
      aria-controls={open && !disabled ? menuId : undefined}
      title={description}
      disabled={disabled}
      onClick={() => setOpen((previous) => !previous)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      <span>{selected?.label || value}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d={open ? "M3 7.5 6 4.5l3 3" : "M3 4.5 6 7.5l3-3"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {open && !disabled ? createPortal(
      <div
        ref={menuRef}
        id={menuId}
        role="listbox"
        aria-label={label}
        className="idea-agent-menu idea-permission-menu"
        style={position}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeAndFocus();
          } else if (event.key === "Tab") {
            closeAndFocus();
          } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
              (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
            items[next]?.focus();
          }
        }}
      >
        {options.map((choice) => <button
          key={choice.id}
          type="button"
          role="option"
          aria-selected={choice.id === value}
          tabIndex={-1}
          onClick={() => { onChange(choice.id); closeAndFocus(); }}
        >
          <span>{choice.label}</span>
          <span aria-hidden="true">{choice.id === value ? "✓" : ""}</span>
        </button>)}
      </div>, document.body,
    ) : null}
  </>;
}
