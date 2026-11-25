import React from "react";
import { type NewProjectMetaLocation } from "../../services/preferences";

export function useFileTreePreferenceState() {
  const [sessionNamingOpen, setSessionNamingOpen] = React.useState(false);
  const [idleReleaseOpen, setIdleReleaseOpen] = React.useState(false);
  const [idleReleaseHours, setIdleReleaseHours] = React.useState("72");
  const [newProjectMetaLocation, setNewProjectMetaLocation] = React.useState<NewProjectMetaLocation>("project");
  const [newProjectMetaLocationBusy, setNewProjectMetaLocationBusy] = React.useState(false);

  return { idleReleaseHours, idleReleaseOpen, newProjectMetaLocation, newProjectMetaLocationBusy, sessionNamingOpen, setIdleReleaseHours, setIdleReleaseOpen, setNewProjectMetaLocation, setNewProjectMetaLocationBusy, setSessionNamingOpen };
}
