// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Everything the CLI may do outside itself, passed in: a few file operations on the owner's own disk, stdin, stdout, stderr and a
 * clock. There is no network member, so no command can reach the network (bin/trustweb.mjs wires this to node:fs; the tests to memory).
 */
export interface Io {
  env: Readonly<Record<string, string | undefined>>
  now(): Date
  exists(path: string): boolean
  readFile(path: string): string
  writeFile(path: string, text: string): void
  readStdin(): string
  /** Moves the file into an `archive/` folder next to it (never deletes) and returns where it went. */
  moveToArchive(path: string): string
  out(text: string): void
  err(text: string): void
}
