export type UserSettings = {
  model: string;
  modelName: string;
  effort: string;
  fastService: string;
};

export type SettingsChange = {
  field: "model" | "effort" | "fastService";
  from: string;
  to: string;
};

// What changed between two consecutive user messages of one session.
//
// The server fills in the model id after the first reply, so a user message
// recorded live can carry an empty model. An empty model on either side means
// "not recorded", never "switched". Effort and fast service are only sent when
// the user chose them, so there an empty value really is "default".
export function settingsChanges(previous: UserSettings, current: UserSettings): SettingsChange[] {
  const changes: SettingsChange[] = [];
  if (previous.model && current.model && previous.model !== current.model) {
    changes.push({
      field: "model",
      from: previous.modelName || previous.model,
      to: current.modelName || current.model,
    });
  }
  if (previous.effort !== current.effort) {
    changes.push({ field: "effort", from: previous.effort, to: current.effort });
  }
  if (previous.fastService !== current.fastService) {
    changes.push({ field: "fastService", from: previous.fastService, to: current.fastService });
  }
  return changes;
}
