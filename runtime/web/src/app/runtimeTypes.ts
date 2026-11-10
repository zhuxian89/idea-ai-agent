export type WSStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type URLState = {
  root: string;
  file: string;
  session: string;
  cursor: number;
  pluginQuery: Record<string, string>;
};
