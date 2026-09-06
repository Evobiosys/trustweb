// Local-files query target (memo item 4): a configurable markdown folder,
// Obsidian-style vault. Reads ONLY .md files under the given folder — never
// anything else, never outside it. The default folder the demo points at is
// a synthetic fixtures corpus (fixtures/vault at the repo root, see
// demo/server.ts and demo/query_infra_demo.ts for path resolution) — this
// module itself takes an explicit folderPath and has no built-in default, so
// it can never accidentally resolve to a real personal vault.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";

export interface VaultNote {
  /** Relative path from the vault root, without extension — stable across
   * runs, used as the match/trace id. */
  id: string;
  /** Absolute path on disk. */
  path: string;
  /** First markdown H1 (`# Title`) if present, else the filename. */
  title: string;
  body: string;
}

function firstHeading(body: string, fallback: string): string {
  const match = body.match(/^\s*#\s+(.+)$/m);
  return match ? match[1]!.trim() : fallback;
}

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, root, out);
    } else if (stat.isFile() && extname(entry).toLowerCase() === ".md") {
      out.push(full);
    }
  }
}

/** Loads every .md file under folderPath (recursively, Obsidian-style
 * subfolders included). Returns [] if the folder doesn't exist yet rather
 * than throwing — a fresh/empty vault is a valid, if unhelpful, state. */
export function loadVault(folderPath: string): VaultNote[] {
  let files: string[] = [];
  try {
    walk(folderPath, folderPath, files);
  } catch {
    return [];
  }
  files.sort();
  return files.map((full) => {
    const body = readFileSync(full, "utf8");
    const rel = relative(folderPath, full).replace(/\.md$/i, "");
    return {
      id: rel,
      path: full,
      title: firstHeading(body, basename(full, ".md")),
      body,
    };
  });
}
