import { useState, useRef } from "react";
import { type PluginSourceBundle } from "../../plugins/manager";
import { readURLState } from "../urlState";

export function usePluginState() {
  const [pluginVersion, setPluginVersion] = useState(0);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pendingPluginTrust, setPendingPluginTrust] = useState<{
    rootId: string;
    bundle: PluginSourceBundle;
  } | null>(null);
  const [pluginBypass, setPluginBypass] = useState(false);
  const [pluginQuery, setPluginQuery] = useState<Record<string, string>>(
    () => readURLState().pluginQuery,
  );
  const pluginQueryRef = useRef<Record<string, string>>(
    readURLState().pluginQuery,
  );

  return { pendingPluginTrust, pluginBypass, pluginLoading, pluginQuery, pluginQueryRef, pluginVersion, setPendingPluginTrust, setPluginBypass, setPluginLoading, setPluginQuery, setPluginVersion };
}
