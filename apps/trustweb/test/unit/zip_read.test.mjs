// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { deflateRawSync } from 'node:zlib'
import { zipStore, crc32 } from '../../src/zip.ts'
import { readZip, ZipTooBig } from '../../src/zip_read.ts'

const dec = new TextDecoder()
const text = async (e) => dec.decode(e.data)

/** A one-file zip with the DEFLATE method (what WhatsApp's share sheet makes). */
function deflated(name, body) {
  const raw = new TextEncoder().encode(body)
  const comp = deflateRawSync(raw)
  const nm = new TextEncoder().encode(name)
  const local = new Uint8Array(30); const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc32(raw), true)
  lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nm.length, true)
  const cen = new Uint8Array(46); const cv = new DataView(cen.buffer)
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc32(raw), true)
  cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, 0, true)
  const end = new Uint8Array(22); const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true)
  ev.setUint32(12, 46 + nm.length, true); ev.setUint32(16, 30 + nm.length + comp.length, true)
  return Uint8Array.from([...local, ...nm, ...comp, ...cen, ...nm, ...end])
}

describe('readZip', () => {
  it('reads stored entries', async () => {
    const z = zipStore([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.txt', data: 'wörld' }], new Date(2026, 10, 4))
    const out = await readZip(z)
    expect(out.map((e) => e.name)).toEqual(['a.txt', 'dir/b.txt'])
    expect(await text(out[1])).toBe('wörld')
  })
  it('reads deflated entries', async () => {
    const body = '[03.10.2026, 18:20:11] Ben: Hallo\n'.repeat(50)
    const out = await readZip(deflated('_chat.txt', body))
    expect(await text(out[0])).toBe(body)
  })
  it('rejects bytes that are no zip', async () => {
    await expect(readZip(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/zip/)
  })
  it('refuses an entry that claims more than the limit', async () => {
    const z = zipStore([{ name: 'big.txt', data: 'x'.repeat(100) }], new Date(2026, 10, 4))
    await expect(readZip(z, 50)).rejects.toBeInstanceOf(ZipTooBig)
  })
})
