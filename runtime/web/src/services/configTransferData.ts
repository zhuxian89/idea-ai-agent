import type { MessageKey } from "../i18n";

export const CONFIG_ARCHIVE_FORMAT = "mindfs-user-config";
export const CONFIG_ARCHIVE_MAX_BYTES = (32 << 20) - (64 << 10);

export const CONFIG_CATEGORIES = [
  { id: "agent_backups", defaultSelected: false, sensitive: true, device: true },
  { id: "providers", defaultSelected: true, sensitive: false, device: false },
  { id: "api_keys", defaultSelected: false, sensitive: true, device: false },
  { id: "custom_agents", defaultSelected: false, sensitive: true, device: true },
] as const;

export type ConfigCategory = typeof CONFIG_CATEGORIES[number]["id"];
export type ConfigArchive = {
  format: typeof CONFIG_ARCHIVE_FORMAT;
  version: 1;
  created_at: string;
  platform: string;
  sections: Partial<Record<ConfigCategory, unknown>>;
};

export function categoryLabel(id: ConfigCategory): MessageKey {
  return `configTransfer.category.${id}`;
}

export function categoryDescription(id: ConfigCategory): MessageKey {
  return `configTransfer.description.${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseConfigArchive(text: string): ConfigArchive {
  if (new TextEncoder().encode(text).length > CONFIG_ARCHIVE_MAX_BYTES) {
    throw new Error("configTransfer.tooLarge");
  }
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || data.format !== CONFIG_ARCHIVE_FORMAT || data.version !== 1 ||
      typeof data.created_at !== "string" || typeof data.platform !== "string" || !isRecord(data.sections)) {
    throw new Error("configTransfer.invalidFile");
  }
  // MindFS archives may include settings outside Agent configuration.
  const sections: ConfigArchive["sections"] = {};
  for (const { id } of CONFIG_CATEGORIES) {
    if (Object.prototype.hasOwnProperty.call(data.sections, id)) {
      if (data.sections[id] === null) throw new Error("configTransfer.invalidFile");
      sections[id] = data.sections[id];
    }
  }
  return { format: CONFIG_ARCHIVE_FORMAT, version: 1, created_at: data.created_at, platform: data.platform, sections };
}

export function importableConfigCategories(archive: ConfigArchive): ConfigCategory[] {
  return CONFIG_CATEGORIES.filter(({ id }) => Object.prototype.hasOwnProperty.call(archive.sections, id)).map(({ id }) => id);
}
