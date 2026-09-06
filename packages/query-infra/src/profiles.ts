// Named owner profiles ("general" + per-use-case alter egos) for Gate-2
// identity reveal and proactive reach-out. One JSON object per line
// (profiles.jsonl) so a new use-case profile is a one-line append, not a
// full-array rewrite. Legacy profiles.json (a single JSON array) is still
// readable as a fallback when no .jsonl file exists.
//
// profileById() NEVER silently substitutes a different identity: an unknown
// id — explicit or the implicit "general" default — throws. A silent
// fallback here would mean a requester could be pointed at the wrong contact
// under the owner's name, which is worse than failing loudly.
import { existsSync, readFileSync } from "node:fs";
import type { OwnerProfile } from "@resource-web/network-access";

export class ProfileError extends Error {}
export class ProfileNotFoundError extends ProfileError {}

function validateProfile(obj: unknown, where: string): OwnerProfile {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new ProfileError(`${where}: profile must be a JSON object`);
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.trim() === "") {
    throw new ProfileError(`${where}: profile missing a non-empty "id"`);
  }
  if (typeof o.name !== "string" || o.name.trim() === "") {
    throw new ProfileError(`${where}: profile "${o.id}" missing a non-empty "name"`);
  }
  if (typeof o.contact !== "string" || o.contact.trim() === "") {
    throw new ProfileError(`${where}: profile "${o.id}" missing a non-empty "contact"`);
  }
  if (o.blurb !== undefined && typeof o.blurb !== "string") {
    throw new ProfileError(`${where}: profile "${o.id}" has a non-string "blurb"`);
  }
  const profile: OwnerProfile = { id: o.id, name: o.name, contact: o.contact };
  if (typeof o.blurb === "string") profile.blurb = o.blurb;
  return profile;
}

/** Parse one JSON object per line (blank lines skipped). Throws ProfileError
 * naming the offending line on malformed JSON or a missing required field. */
export function parseProfilesJsonl(raw: string): OwnerProfile[] {
  const profiles: OwnerProfile[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new ProfileError(`profiles.jsonl line ${i + 1}: invalid JSON`);
    }
    profiles.push(validateProfile(obj, `profiles.jsonl line ${i + 1}`));
  }
  return profiles;
}

/** Legacy shape: a single JSON array, e.g. the pre-migration profiles.json. */
export function parseProfilesJson(raw: string): OwnerProfile[] {
  const arr = JSON.parse(raw) as unknown;
  if (!Array.isArray(arr)) throw new ProfileError("profiles.json: expected a JSON array");
  return arr.map((o, i) => validateProfile(o, `profiles.json[${i}]`));
}

/** Reads profilesJsonlPath if it exists; else falls back to legacy
 * profilesJsonPath (single JSON array) if given and present. Throws if
 * neither is readable. */
export function loadProfilesFile(profilesJsonlPath: string, profilesJsonPath?: string): OwnerProfile[] {
  if (existsSync(profilesJsonlPath)) {
    return parseProfilesJsonl(readFileSync(profilesJsonlPath, "utf8"));
  }
  if (profilesJsonPath && existsSync(profilesJsonPath)) {
    return parseProfilesJson(readFileSync(profilesJsonPath, "utf8"));
  }
  throw new ProfileError(
    `no profiles file found (looked for ${profilesJsonlPath}${profilesJsonPath ? ` and legacy ${profilesJsonPath}` : ""})`,
  );
}

/** Look up a profile by id. Omitting id resolves to "general". Unknown id
 * (given explicitly, or "general" itself missing) throws — never a silent
 * fallback to a different identity. */
export function profileById(profiles: OwnerProfile[], id?: string): OwnerProfile {
  const targetId = id ?? "general";
  const found = profiles.find((p) => p.id === targetId);
  if (!found) throw new ProfileNotFoundError(`unknown profile id "${targetId}"`);
  return found;
}
