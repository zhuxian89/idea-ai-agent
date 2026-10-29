const pairingParameter = "mindfs_pairing";

export function buildPairingLink(nodeURL: string, secret: string): string {
  const url = new URL(nodeURL);
  // Fragments stay in the browser rather than entering HTTP requests or Relay logs.
  url.hash = new URLSearchParams({ [pairingParameter]: secret }).toString();
  return url.toString();
}

export function consumePairingLink(): string {
  if (typeof window === "undefined" || !/^\/n\/[^/]+(?:\/|$)/.test(window.location.pathname)) return "";
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!fragment.has(pairingParameter)) return "";
  const secret = (fragment.get(pairingParameter) || "").trim();
  fragment.delete(pairingParameter);
  url.hash = fragment.toString();
  window.history.replaceState(window.history.state, "", url.toString());
  return secret;
}
