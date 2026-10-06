/**
 * Writes the missing Duration into a WebM take (wave 1733, item 4b / A4).
 *
 * Chromium's MediaRecorder writes WebM as a live stream: the Segment has an
 * unknown size, the Info element has no Duration and there are no Cues. A
 * player then reports the duration as Infinity and seeking is unreliable. This
 * adds a Duration (EBML id 0x4489, float64, in TimecodeScale units) into the
 * Segment's Info element, in house, no dependency. Only the head of the file
 * is read (Info sits in the first few hundred bytes); the rest of the blob is
 * reused as it is (Blob slices), so a 1 h take is never copied into memory.
 *
 * Anything that is not such a file (MP4 from Safari, a WebM that already has a
 * Duration, an Info element beyond the head) is returned unchanged.
 */

const ID_EBML = 0x1a45dfa3
const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_DURATION = 0x4489
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_CLUSTER = 0x1f43b675

/** How much of the file head is read to find the Info element. */
export const HEAD_BYTES = 64 * 1024

interface Vint { value: number; length: number; unknown: boolean }

/** An EBML variable-size integer (an element's size) at `pos`; null if malformed or beyond the buffer. */
export function readVint(b: Uint8Array, pos: number): Vint | null {
  if (pos >= b.length) return null
  const first = b[pos]
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  if (length > 8 || pos + length > b.length) return null
  let value = first & (0xff >> length)
  let allOnes = value === (0xff >> length)
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[pos + i]
    if (b[pos + i] !== 0xff) allOnes = false
  }
  return { value, length, unknown: allOnes }
}

/** An EBML element id at `pos` (its marker bits kept, as ids are written). */
export function readId(b: Uint8Array, pos: number): { id: number; length: number } | null {
  if (pos >= b.length) return null
  const first = b[pos]
  let length = 1
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++
  if (length > 4 || pos + length > b.length) return null
  let id = 0
  for (let i = 0; i < length; i++) id = id * 256 + b[pos + i]
  return { id, length }
}

/** An element size as an EBML vint of exactly `length` bytes; null if it does not fit. */
export function encodeSize(value: number, length: number): Uint8Array<ArrayBuffer> | null {
  if (length < 1 || length > 8 || value >= 2 ** (7 * length) - 1) return null
  const out = new Uint8Array(length)
  let v = value
  for (let i = length - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256) }
  out[0] |= 0x80 >> (length - 1)
  return out
}

function readUint(b: Uint8Array, pos: number, len: number): number {
  let v = 0
  for (let i = 0; i < len; i++) v = v * 256 + b[pos + i]
  return v
}

/** One byte range of the original file and what replaces it. */
export interface Edit { start: number; end: number; bytes: Uint8Array<ArrayBuffer> }

/**
 * The edits that give a WebM head a Duration of `durationMs`: the Info
 * element rewritten with a Duration appended (and the Segment size, when it
 * is a known size, grown by as much). Null where nothing should change.
 */
export function durationEdits(head: Uint8Array, durationMs: number): Edit[] | null {
  if (!(durationMs > 0)) return null
  const ebml = readId(head, 0)
  if (!ebml || ebml.id !== ID_EBML) return null
  const ebmlSize = readVint(head, ebml.length)
  if (!ebmlSize || ebmlSize.unknown) return null
  const segPos = ebml.length + ebmlSize.length + ebmlSize.value
  const seg = readId(head, segPos)
  if (!seg || seg.id !== ID_SEGMENT) return null
  const segSize = readVint(head, segPos + seg.length)
  if (!segSize) return null
  let pos = segPos + seg.length + segSize.length
  while (pos < head.length) {
    const id = readId(head, pos)
    const size = id && readVint(head, pos + id.length)
    if (!id || !size || size.unknown || id.id === ID_CLUSTER) return null
    const payload = pos + id.length + size.length
    const end = payload + size.value
    if (id.id !== ID_INFO) { pos = end; continue }
    if (end > head.length) return null
    let scale = 1_000_000
    for (let p = payload; p < end;) {
      const cid = readId(head, p)
      const csize = cid && readVint(head, p + cid.length)
      if (!cid || !csize || csize.unknown) return null
      if (cid.id === ID_DURATION) return null
      if (cid.id === ID_TIMECODE_SCALE) scale = readUint(head, p + cid.length + csize.length, csize.value)
      p += cid.length + csize.length + csize.value
    }
    const duration = new Uint8Array(11)
    duration.set([0x44, 0x89, 0x88])
    new DataView(duration.buffer).setFloat64(3, (durationMs * 1_000_000) / scale)
    const newSize = encodeSize(size.value + duration.length, size.length) ?? encodeSize(size.value + duration.length, 8)
    if (!newSize) return null
    const info = new Uint8Array(id.length + newSize.length + size.value + duration.length)
    info.set(head.subarray(pos, pos + id.length), 0)
    info.set(newSize, id.length)
    info.set(head.subarray(payload, end), id.length + newSize.length)
    info.set(duration, id.length + newSize.length + size.value)
    const edits: Edit[] = []
    if (!segSize.unknown) {
      const grown = encodeSize(segSize.value + info.length - (end - pos), segSize.length)
      if (!grown) return null
      edits.push({ start: segPos + seg.length, end: segPos + seg.length + segSize.length, bytes: grown })
    }
    edits.push({ start: pos, end, bytes: info })
    return edits
  }
  return null
}

/** The take with its Duration written where it was missing; otherwise the take as it was. */
export async function withDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!/webm/i.test(blob.type)) return blob
  try {
    const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer())
    const edits = durationEdits(head, durationMs)
    if (!edits) return blob
    const parts: BlobPart[] = []
    let at = 0
    for (const e of edits) {
      parts.push(blob.slice(at, e.start), e.bytes)
      at = e.end
    }
    parts.push(blob.slice(at))
    return new Blob(parts, { type: blob.type })
  } catch {
    return blob
  }
}
