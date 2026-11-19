export function applyViewportBounds(height: number, offsetTop = 0): void {
  const style = document.documentElement.style;
  style.setProperty("--mindfs-viewport-height", `${height}px`);
  style.setProperty("--mindfs-viewport-offset-top", `${offsetTop}px`);
}

export function syncBrowserViewport(): void {
  const viewport = window.visualViewport;
  applyViewportBounds(viewport?.height ?? window.innerHeight, Math.max(0, viewport?.offsetTop || 0));
}
