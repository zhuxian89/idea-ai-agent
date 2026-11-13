import { z } from "zod";

const releasesSchema = z.array(z.object({
  tag_name: z.string(), draft: z.boolean(), assets: z.array(z.object({ name: z.string() })),
}));
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-standalone\.(\d+))?$/;

export function compareStandaloneVersions(left: string, right: string): number {
  const parts = (value: string) => {
    const match = versionPattern.exec(value);
    if (!match) throw new Error(`Unrecognized standalone version: ${value}`);
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? Number(match[4]) : Infinity];
  };
  const a = parts(left), b = parts(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function selectStandaloneRelease(input: unknown, platform: string): string {
  const versions = releasesSchema.parse(input).flatMap(release => {
    const version = release.tag_name.replace(/^standalone-v/, "");
    if (release.draft || !release.tag_name.startsWith("standalone-v") || !versionPattern.test(version)) return [];
    const archive = `local-ai-agent-${version}-${platform}.${platform.startsWith("windows-") ? "zip" : "tar.gz"}`;
    const names = new Set(release.assets.map(asset => asset.name));
    return names.has(archive) && names.has(`${archive}.sha256`) ? [version] : [];
  });
  versions.sort(compareStandaloneVersions);
  const latest = versions.at(-1);
  if (!latest) throw new Error(`No standalone release with a package and checksum for ${platform}`);
  return latest;
}

export async function checkStandaloneRelease(platform: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("https://api.github.com/repos/zhuxian89/idea-ai-agent/releases?per_page=100", {
    headers: { Accept: "application/vnd.github+json" }, signal, cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);
  return selectStandaloneRelease(await response.json(), platform);
}
