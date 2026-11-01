// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (sovereign-switch): a minimal zip writer, STORE only (no compression), so an export needs no dependency. Pure.
 * Layout per APPNOTE: local header + data per file, then the central directory, then the end record. Names are UTF-8 (flag bit 11).
 */

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipFile { name: string; data: string | Uint8Array }

/** MS-DOS time and date of a local Date (2-second resolution, 1980 at the earliest). */
function dosTime(d: Date): [number, number] {
  const y = Math.max(1980, d.getFullYear())
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()]
}

export function zipStore(files: readonly ZipFile[], date: Date): Uint8Array {
  const enc = new TextEncoder()
  const [time, day] = dosTime(date)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const header = (size: number, write: (v: DataView) => void): Uint8Array => { const b = new Uint8Array(size); write(new DataView(b.buffer)); return b }
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(data)
    // Shared fields of the local (from byte 4) and central (from byte 6) headers: version, flags, method, time, date, crc, sizes, name length.
    const common = (v: DataView, at: number): void => {
      v.setUint16(at, 20, true); v.setUint16(at + 2, 0x0800, true); v.setUint16(at + 4, 0, true)
      v.setUint16(at + 6, time, true); v.setUint16(at + 8, day, true); v.setUint32(at + 10, crc, true)
      v.setUint32(at + 14, data.length, true); v.setUint32(at + 18, data.length, true); v.setUint16(at + 22, name.length, true)
    }
    const local = header(30, (v) => { v.setUint32(0, 0x04034b50, true); common(v, 4) })
    central.push(header(46, (v) => { v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); common(v, 6); v.setUint32(42, offset, true) }), name)
    parts.push(local, name, data)
    offset += local.length + name.length + data.length
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0)
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true)
    v.setUint32(12, dirSize, true); v.setUint32(16, offset, true)
  })
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0))
  let p = 0
  for (const b of all) { out.set(b, p); p += b.length }
  return out
}
