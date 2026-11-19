import React, { useState } from "react";
import "../../src/services/remoteUi";
import { RemoteShell } from "../../src/layout/RemoteShell";
import { GlowSettingsDialog } from "../../src/components/remoteui/GlowSettingsDialog";
import { normalizeGlowConfig } from "../../src/services/remoteGlow";

declare global { interface Window { fixture: any; configSwitchEvents: number } }

export function RemoteDesignFixture() {
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [multi, setMulti] = useState(false);
  const [glow, setGlow] = useState(false);
  window.configSwitchEvents = window.configSwitchEvents || 0;
  if (!(window as any).__listening) {
    (window as any).__listening = true;
    window.addEventListener("mindfs:open-agent-config-switch", () => { window.configSwitchEvents += 1; });
  }
  window.fixture = { openGlow: () => setGlow(true), normalize: normalizeGlowConfig };
  return (
    <>
      <RemoteShell
        left={{ content: <div id="files-pane">FILES</div>, open: left, width: "260px", toggleLabel: left ? "Collapse files" : "Expand files", onToggle: () => setLeft((v) => !v) }}
        right={{ content: <div id="sessions-pane">SESSIONS</div>, open: right, width: "280px", toggleLabel: right ? "Collapse sessions" : "Expand sessions", onToggle: () => setRight((v) => !v) }}
        main={<div id="main-body"><div id="activity" data-session-activity data-activity-kind="work" /></div>}
        footer={<div id="footer-body">FOOTER</div>}
        topBar={{ multiProjectSessionsEnabled: multi, onMultiProjectSessionsChange: setMulti }}
        fileMenuWidth="182px"
      />
      <GlowSettingsDialog open={glow} onClose={() => setGlow(false)} />
    </>
  );
}
