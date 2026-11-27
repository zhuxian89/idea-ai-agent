import type { ComponentProps } from "react";

const paths = {
  edit: "m14.5 6.5 3 3M4 20l4-.8L20 7a2.1 2.1 0 0 0-3-3L5 16z",
  refresh: "M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5",
  pause: "M9 5v14m6-14v14",
  close: "m6 6 12 12M18 6 6 18",
  chevron: "m6 9 6 6 6-6",
  process: "M20 15a2 2 0 0 1-2 2H9l-5 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2zM8 8h8m-8 4h5",
  details: "M5 5h14v14H5zM8 9h8m-8 3h8m-8 3h5",
  file: "M14 3H6v18h12V7zM14 3v5h4M9 12h6m-6 4h6",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  save: "M5 4h12l3 3v13H4V4zM8 4v6h8V4m-8 16v-6h8v6",
  play: "m8 5 12 7-12 7z",
  next: "M4 12h15m-6-6 6 6-6 6",
  back: "M20 12H5m6-6-6 6 6 6",
  check: "m5 12 4 4L19 6",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  shield: "M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z",
  alert: "M12 4l9 16H3zM12 10v4m0 3h.01",
  attach: "M8 13l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8m-4 12 8-8",
  send: "M3 4l18 8-18 8 4-8zM7 12h14",
};

export function CollabIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>;
}

type IconButtonProps = Omit<ComponentProps<"button">, "children" | "type"> & {
  icon: keyof typeof paths;
  label: string;
};

export function CollabIconButton({ icon, label, title = label, className = "collab-icon-btn", ...props }: IconButtonProps) {
  return <button {...props} type="button" className={className} aria-label={label} title={title}>
    <CollabIcon name={icon} />
  </button>;
}
