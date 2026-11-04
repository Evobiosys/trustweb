// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * A minimal zip reader for chat exports: central directory, methods STORE and DEFLATE (the browser's DecompressionStream, no dependency).
 * Not supported: encryption, zip64, multi-disk. An entry that claims more than `limit` bytes is refused before it is inflated.
 */
export interface ZipEntry { name: string; data: Uint8Array }
export class ZipTooBig extends Error {}

const END_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

async function inflateRaw(comp: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([comp.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.length
    if (n > limit) { void reader.cancel(); throw new ZipTooBig() }
    chunks.push(value)
  }
  const out = new Uint8Array(n)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

export async function readZip(bytes: Uint8Array, limit = 20 * 1024 * 1024): Promise<ZipEntry[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (v.getUint32(i, true) === END_SIG) { end = i; break }
  if (end < 0) throw new Error('not a zip file')
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const dec = new TextDecoder()
  const out: ZipEntry[] = []
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== CENTRAL_SIG) throw new Error('broken zip directory')
    const method = v.getUint16(p + 10, true)
    const csize = v.getUint32(p + 20, true)
    const size = v.getUint32(p + 24, true)
    const nameLen = v.getUint16(p + 28, true)
    const next = p + 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p = next
    if (name.endsWith('/')) continue
    if (size > limit) throw new ZipTooBig()
    if (local + 30 > bytes.length || v.getUint32(local, true) !== LOCAL_SIG) throw new Error('broken zip entry')
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    const raw = bytes.subarray(start, start + csize)
    if (method === 0) out.push({ name, data: raw })
    else if (method === 8) out.push({ name, data: await inflateRaw(raw, limit) })
    else throw new Error(`zip method ${method} not supported`)
  }
  return out
}
