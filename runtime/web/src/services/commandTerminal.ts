export const commandTerminalFontSize = 12;

export const commandTerminalFontFamily =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei Mono", "Microsoft YaHei", "Noto Sans Mono CJK SC", monospace';

export function measureCommandTerminalCellWidth(): number {
  if (typeof document === "undefined") return 7.25;
  const probe = document.createElement("span");
  probe.textContent = "mmmmmmmmmm";
  probe.style.position = "fixed";
  probe.style.left = "-9999px";
  probe.style.top = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.whiteSpace = "pre";
  probe.style.fontFamily = commandTerminalFontFamily;
  probe.style.fontSize = `${commandTerminalFontSize}px`;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 10;
  probe.remove();
  return width > 0 ? width : 7.25;
}

export function estimateCommandTerminalCols(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const maxElementWidth = (selector: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).reduce((max, element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? Math.max(max, rect.width) : max;
    }, 0);
  const inputWidth = maxElementWidth('[data-mindfs-command-input-width="1"]');
  const contentWidth = maxElementWidth('[data-mindfs-session-content-width="1"]');
  const elementWidth = Math.max(inputWidth, contentWidth);
  const width = elementWidth || window.visualViewport?.width || window.innerWidth || 0;
  if (width <= 0) return undefined;
  const isMobile = width < 768;
  const terminalChrome = isMobile ? 92 : 72;
  const usableWidth = Math.max(280, width - terminalChrome);
  const cellWidth = measureCommandTerminalCellWidth();
  const cols = Math.floor(usableWidth / cellWidth) - 1;
  return Math.max(40, Math.min(500, cols));
}
