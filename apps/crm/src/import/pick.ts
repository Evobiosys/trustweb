/** Reads the files the person picked (File objects only; no folder paths are kept). */
import type { FileInput } from './intake'

export const MAX_FILE_BYTES = 100 * 1024 * 1024
const READABLE = /\.(vcf|csv|json)$/i

export interface Picked {
  files: FileInput[]
  /** Files with another extension, counted and not read. */
  other: number
  /** Readable kinds over the size cap, not read. */
  tooBig: number
}

export async function readPicked(list: readonly File[]): Promise<Picked> {
  const picked: Picked = { files: [], other: 0, tooBig: 0 }
  for (const f of list) {
    if (!READABLE.test(f.name)) picked.other++
    else if (f.size > MAX_FILE_BYTES) picked.tooBig++
    else picked.files.push({ name: f.name, text: await f.text() })
  }
  return picked
}
