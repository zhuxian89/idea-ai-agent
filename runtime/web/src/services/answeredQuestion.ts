import type { Session, ToolCall } from "./session";

// Patch only the identified question, including saved auxiliary history. Never
// append an old call to a new turn, change pending, or fabricate progress time.
export function applyAnsweredQuestion<T extends Pick<Session, "exchanges" | "exchange_aux">>(session: T, answer: ToolCall): T {
  if (!answer.callId || answer.kind !== "ask_user" || answer.status !== "complete") return session;
  let changed = false;
  const patch = (call?: ToolCall) => {
    if (!call || call.callId !== answer.callId || call.kind !== "ask_user") return call;
    changed = true;
    return { ...call, ...answer, meta: { ...call.meta, ...answer.meta } };
  };
  const exchanges = session.exchanges?.map(exchange => exchange.toolCall
    ? { ...exchange, toolCall: patch(exchange.toolCall) } : exchange);
  const exchange_aux = session.exchange_aux && Object.fromEntries(Object.entries(session.exchange_aux)
    .map(([seq, items]) => [seq, items.map(item => item.toolcall ? { ...item, toolcall: patch(item.toolcall) } : item)]));
  return changed ? { ...session, exchanges, exchange_aux } : session;
}
