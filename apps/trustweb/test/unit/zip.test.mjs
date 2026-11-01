// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (sovereign-switch): the store-only zip writer (zip.ts), read back by a tiny unzip. */
import { crc32, zipStore } from '../../src/zip.ts'

/** Reads every entry from the central directory; checks each local header and CRC. */
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = buf.length - 22
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out = {}
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50)
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen))
    expect(dv.getUint32(local, true)).toBe(0x04034b50)
    expect(dv.getUint16(local + 8, true)).toBe(0) // stored, no compression
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
    const data = buf.subarray(start, start + size)
    expect(crc32(data)).toBe(crc)
    out[name] = new TextDecoder().decode(data)
    p += 46 + nameLen + extra + comment
  }
  return out
}

describe('zip (store only)', () => {
  it('CRC32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })
  it('round trip: every file comes back byte for byte, UTF-8 names and text included', () => {
    const files = [{ name: 'README.md', data: '# Hello\n' }, { name: 'people.md', data: '- Zoë ✓\n' }, { name: 'empty.txt', data: '' }, { name: 'bin', data: new Uint8Array([0, 255, 7]) }]
    const z = zipStore(files, new Date(2026, 9, 31, 14, 30))
    const back = unzip(z)
    expect(Object.keys(back)).toEqual(['README.md', 'people.md', 'empty.txt', 'bin'])
    expect(back['people.md']).toBe('- Zoë ✓\n')
    expect(back['empty.txt']).toBe('')
  })
  it('is deterministic for the same files and date', () => {
    const f = [{ name: 'a.txt', data: 'a' }]
    const d = new Date(2026, 0, 2, 3, 4)
    expect(zipStore(f, d)).toEqual(zipStore(f, d))
  })
})
