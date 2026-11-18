import { protectedJSON } from "./api";
import { appPath } from "./base";
import { downloadBlob } from "./download";
import { CONFIG_ARCHIVE_MAX_BYTES, type ConfigArchive, type ConfigCategory } from "./configTransferData";
import type { AgentConfigBackup } from "./agentConfig";

export type ImportedAgentBackup = Pick<AgentConfigBackup, "id" | "agent" | "name">;

export async function exportUserConfig(agents: string[]): Promise<void> {
  const archive = await protectedJSON<ConfigArchive>(appPath("/api/config/export"), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agents }),
  });
  const blob = new Blob([JSON.stringify(archive)], { type: "application/json" });
  if (blob.size > CONFIG_ARCHIVE_MAX_BYTES) throw new Error("configTransfer.tooLarge");
  await downloadBlob(blob, `agent-config-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function importUserConfig(
  archive: ConfigArchive, categories: ConfigCategory[], confirmOverwrite = false,
): Promise<{ restart_required: boolean; needs_confirm: boolean; backups?: ImportedAgentBackup[] }> {
  const sections = Object.fromEntries(categories.map(id => [id, archive.sections[id]]));
  return protectedJSON(appPath("/api/config/import"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archive: { ...archive, sections }, categories, confirm_overwrite: confirmOverwrite }),
  });
}
