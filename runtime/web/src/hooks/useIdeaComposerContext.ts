import { useEffect, useLayoutEffect, useRef } from "react";
import { subscribeIdeaContext, type IdeaContextTarget } from "../services/ideaBridge";
import { composerDraftKey, subscribeComposerDraftPromotion } from "../services/composerDrafts";

type Attachment = { previewUrl?: string };
type Draft<T> = { text: string; attachments: T[] };
type WriteOptions = { contextAdded: boolean; resetHistory: boolean };
type Options<T> = {
  rootId: string;
  sessionKey: string;
  busy: boolean;
  draft: Draft<T>;
  write: (draft: Draft<T>, options: WriteOptions) => void;
  newSession?: () => void;
};

/** Keep drafts local to the project/session and route native captures without sending. */
export function useIdeaComposerContext<T extends Attachment>(options: Options<T>): void {
  const latest = useRef(options);
  latest.current = options;
  const drafts = useRef(new Map<string, Draft<T>>());
  const activeKey = useRef(composerDraftKey(options.rootId, options.sessionKey));
  const pending = useRef<{ text: string; target: IdeaContextTarget; key: string; rootId: string }[]>([]);

  const write = (draft: Draft<T>, settings: WriteOptions) => {
    latest.current.draft = draft;
    latest.current.write(draft, settings);
  };

  useLayoutEffect(() => subscribeComposerDraftPromotion((from, to) => {
    const saved = drafts.current.get(from);
    if (saved) {
      drafts.current.set(to, saved);
      drafts.current.delete(from);
    }
    if (activeKey.current === from) activeKey.current = to;
    for (const request of pending.current) if (request.key === from) request.key = to;
  }), []);

  useLayoutEffect(() => {
    if (options.busy) return;
    const key = composerDraftKey(options.rootId, options.sessionKey);
    if (activeKey.current === key) return;
    drafts.current.set(activeKey.current, latest.current.draft);
    activeKey.current = key;
    const restored = drafts.current.get(key) || { text: "", attachments: [] };
    drafts.current.delete(key);
    write(restored, { contextAdded: false, resetHistory: true });
  });

  const flush = () => {
    // The request keeps its click-time destination while a send/voice insertion
    // finishes. Switching tabs during that wait must not redirect its contents.
    if (latest.current.busy) return;
    for (const { text, target, key, rootId } of pending.current.splice(0)) {
      const current = latest.current;
      const blankKey = composerDraftKey(rootId);
      const destination = target === "new" ? blankKey : key;
      let resetHistory = false;
      if (rootId !== current.rootId || (target === "current" && destination !== activeKey.current)) {
        const saved = drafts.current.get(destination) || { text: "", attachments: [] };
        drafts.current.set(destination, { ...saved, text: [saved.text, text].filter(Boolean).join("\n\n") });
        continue;
      }
      if (target === "new" && activeKey.current !== blankKey) {
        if (!current.newSession) continue;
        drafts.current.set(activeKey.current, current.draft);
        activeKey.current = blankKey;
        // An existing unsent new-session draft is retained, never overwritten.
        const blank = drafts.current.get(blankKey) || { text: "", attachments: [] };
        drafts.current.delete(blankKey);
        current.draft = blank;
        current.newSession();
        resetHistory = true;
      }
      const next = [current.draft.text, text].filter(Boolean).join("\n\n");
      write({ ...current.draft, text: next }, { contextAdded: true, resetHistory });
    }
  };

  useEffect(() => {
    if (!options.rootId) return;
    return subscribeIdeaContext((text, target) => {
      const current = latest.current;
      const key = current.busy ? composerDraftKey(current.rootId, current.sessionKey) : activeKey.current;
      pending.current.push({ text, target, key, rootId: current.rootId });
      flush();
    });
  }, [options.rootId]);

  useEffect(() => { flush(); }, [options.busy, options.rootId, options.sessionKey]);

  useEffect(() => () => {
    const urls = new Set<string>();
    for (const draft of [...drafts.current.values(), latest.current.draft]) {
      for (const attachment of draft.attachments) if (attachment.previewUrl) urls.add(attachment.previewUrl);
    }
    for (const url of urls) URL.revokeObjectURL(url);
  }, []);
}
