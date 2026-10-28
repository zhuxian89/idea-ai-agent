// Draft identity follows the existing session lifecycle; it is not persisted.
export const composerDraftKey = (rootId: string, sessionKey = "") => JSON.stringify([rootId, sessionKey]);

type Promotion = (from: string, to: string) => void;
const listeners = new Set<Promotion>();

export function promoteComposerDraft(rootId: string, from: string, to: string): void {
  if (from === to) return;
  for (const listener of listeners) listener(composerDraftKey(rootId, from), composerDraftKey(rootId, to));
}

export function subscribeComposerDraftPromotion(listener: Promotion): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
