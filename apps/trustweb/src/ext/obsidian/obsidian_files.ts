// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: the notes of a picked vault folder, from a directory input (one-shot) or the File System Access API (re-sync
 * without picking again). Only markdown notes count; dot folders (.obsidian, .trash, .git) and big files are skipped. Pure over file-like objects.
 */
export const NOTE_MAX_BYTES = 1_000_000
export const NOTES_MAX = 20_000

export interface FileLike { name: string; size: number; text(): Promise<string>; webkitRelativePath?: string }
export interface VaultFile { path: string; file: FileLike }
export interface VaultFiles { vault: string; files: VaultFile[]; skipped: { tooBig: number; tooMany: number } }

/** A markdown note outside any dot folder. */
export const acceptPath = (path: string): boolean => /\.md$/i.test(path) && !path.split('/').some((seg) => seg.startsWith('.'))

function collect(vault: string, all: readonly VaultFile[]): VaultFiles {
  const skipped = { tooBig: 0, tooMany: 0 }
  const files: VaultFile[] = []
  for (const f of all) {
    if (!acceptPath(f.path)) continue
    if (f.file.size > NOTE_MAX_BYTES) skipped.tooBig++
    else if (files.length >= NOTES_MAX) skipped.tooMany++
    else files.push(f)
  }
  return { vault, files, skipped }
}

/** A directory input: `webkitRelativePath` is `<picked folder>/<path>`. Files picked one by one carry none. */
export function fromInput(list: ArrayLike<FileLike>): VaultFiles {
  const items = Array.from(list)
  const rel = items.map((f) => f.webkitRelativePath ?? '')
  const vault = rel[0]?.includes('/') ? rel[0].split('/')[0] : ''
  return collect(vault, items.map((file, i) => ({ path: vault && rel[i].startsWith(`${vault}/`) ? rel[i].slice(vault.length + 1) : file.name, file })))
}

export interface DirHandleLike {
  kind: 'directory'
  name: string
  entries(): AsyncIterable<[string, DirHandleLike | { kind: 'file'; name: string; getFile(): Promise<FileLike> }]>
}

/** Walks a picked directory handle; dot folders are not entered. */
export async function walkHandle(root: DirHandleLike): Promise<VaultFiles> {
  const all: VaultFile[] = []
  async function walk(dir: DirHandleLike, prefix: string): Promise<void> {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue
      if (h.kind === 'directory') await walk(h, `${prefix}${name}/`)
      else all.push({ path: `${prefix}${name}`, file: await h.getFile() })
    }
  }
  await walk(root, '')
  return collect(root.name, all)
}
