import { useState } from "react";
import { SessionItem } from "../sessionModel";

export function useSessionDialogs() {
  const [scheduledAgentSession, setScheduledAgentSession] = useState<SessionItem | null>(null);
  const [handoffSession, setHandoffSession] = useState<SessionItem | null>(null);
  const [scheduledAgentDialogOpen, setScheduledAgentDialogOpen] =
    useState(false);

  return { handoffSession, scheduledAgentDialogOpen, scheduledAgentSession, setHandoffSession, setScheduledAgentDialogOpen, setScheduledAgentSession };
}
