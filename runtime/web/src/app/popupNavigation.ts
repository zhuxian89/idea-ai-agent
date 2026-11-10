export function openPendingPopup(): Window | null {
  if (typeof window === "undefined") {
    return null;
  }
  const popup = window.open("", "_blank");
  if (!popup) {
    return null;
  }
  try {
    popup.document.title = "Opening Relayer...";
    popup.document.body.innerHTML =
      '<p style="font-family: system-ui, sans-serif; padding: 16px; color: #111827;">Opening Relayer...</p>';
  } catch {}
  return popup;
}

export function navigatePopup(popup: Window | null, url: string): void {
  if (!popup || popup.closed) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    popup.opener = null;
  } catch {}
  try {
    popup.location.replace(url);
  } catch {
    popup.location.href = url;
  }
}
