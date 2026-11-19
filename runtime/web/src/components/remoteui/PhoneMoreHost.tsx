import React, { createContext } from "react";
import { createPortal } from "react-dom";

export type PhoneMoreConnection = "connected" | "connecting" | "reconnecting" | "disconnected";
export const PhoneMoreHostContext = createContext<{ host: HTMLElement; connection?: PhoneMoreConnection } | null>(null);

export function PhoneMoreMount({ host, children }: { host: HTMLElement | null; children: React.ReactNode }) {
  return host ? createPortal(children, host) : children;
}

export function PhoneMoreGroup({ phone, name, title, children }: {
  phone: boolean;
  name: string;
  title: string;
  children: React.ReactNode;
}) {
  return <section className="phone-more-group" data-group={name}>
    {phone && <h2>{title}</h2>}
    <div className="phone-more-rows">{children}</div>
  </section>;
}
