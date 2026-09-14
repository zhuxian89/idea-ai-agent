export type DisclosureChoice = "open" | "closed";
export type DisclosureRef = { rootId: string; sessionKey: string; itemKey: string };

export function activityDisclosureKey({ callId, localKey, groupKey }: { callId?: string; localKey?: string; groupKey?: string }): string {
  return JSON.stringify(groupKey ? ["group", groupKey] : callId ? ["call", callId] : ["local", localKey]);
}

// Choices only. Full tool output must never enter this application-lifetime store.
export class ActivityDisclosureStore {
  private sessions = new Map<string, Map<string, DisclosureChoice>>();
  private listeners = new Set<() => void>();
  private focused?: { session: string; item: string; token: object };
  private revision = 0;

  getRevision = () => this.revision;

  private changed() {
    this.revision++;
    this.listeners.forEach(listener => listener());
  }

  private sessionId(ref: DisclosureRef) {
    return JSON.stringify([ref.rootId, ref.sessionKey]);
  }

  get(ref: DisclosureRef): DisclosureChoice | undefined {
    return this.sessions.get(this.sessionId(ref))?.get(ref.itemKey);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  touch(ref: DisclosureRef) {
    const key = this.sessionId(ref);
    const items = this.sessions.get(key);
    if (!items) return;
    this.sessions.delete(key);
    this.sessions.set(key, items);
    const choice = items.get(ref.itemKey);
    if (choice !== undefined) {
      items.delete(ref.itemKey);
      items.set(ref.itemKey, choice);
    }
  }

  set(ref: DisclosureRef, choice: DisclosureChoice) {
    const key = this.sessionId(ref);
    const items = this.sessions.get(key) || new Map<string, DisclosureChoice>();
    items.set(ref.itemKey, choice);
    this.sessions.set(key, items);
    this.touch(ref);
    while (items.size > 500) {
      const victim = [...items.keys()].find(item => key !== this.focused?.session || item !== this.focused.item)!;
      items.delete(victim);
    }
    while (this.sessions.size > 50) {
      const victim = [...this.sessions.keys()].find(session => session !== this.focused?.session)!;
      this.sessions.delete(victim);
    }
    this.changed();
  }

  isFocused(ref: DisclosureRef): boolean {
    return this.focused?.session === this.sessionId(ref) && this.focused.item === ref.itemKey;
  }

  focus(ref: DisclosureRef) {
    const token = {};
    this.focused = { session: this.sessionId(ref), item: ref.itemKey, token };
    this.touch(ref);
    this.changed();
    return () => {
      if (this.focused?.token === token) { this.focused = undefined; this.changed(); }
    };
  }
}

export const activityDisclosure = new ActivityDisclosureStore();
