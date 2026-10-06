/**
 * Recordings kept on the phone (wave 1733, item 4b): the caps (oldest audio
 * first), finding a moment across takes, and the WebM Duration patch that lets
 * a MediaRecorder take seek (src/audio_plan.ts, src/audio_store.ts locate,
 * src/webm_duration.ts).
 */
import { MAX_BYTES, MAX_RECORDINGS, clampAudioPlan, megabytes } from '../../src/audio_plan.ts'
import { AudioStore, locate } from '../../src/audio_store.ts'
import { durationEdits, encodeSize, readId, readVint, withDuration } from '../../src/webm_duration.ts'

const MB = 1024 * 1024

describe('clampAudioPlan', () => {
  const e = (id, savedAt, bytes) => ({ id, savedAt, bytes })
  it('keeps everything within both caps', () => expect(clampAudioPlan([e('a', 1, MB), e('b', 2, MB)])).toEqual([]))
  it('drops the oldest first when there are too many', () => {
    const many = Array.from({ length: MAX_RECORDINGS + 2 }, (_, i) => e('m' + i, 1000 - i, MB))
    expect(clampAudioPlan(many)).toEqual(['m21', 'm20'])
  })
  it('drops the oldest first when they are too big, until the bytes fit', () => {
    expect(clampAudioPlan([e('new', 3, 200 * MB), e('old', 1, 80 * MB), e('mid', 2, 50 * MB)])).toEqual(['old'])
    expect(clampAudioPlan([e('new', 3, 200 * MB), e('old', 1, 90 * MB), e('mid', 2, 50 * MB)], MAX_RECORDINGS, MAX_BYTES)).toEqual(['old'])
    expect(clampAudioPlan([e('new', 3, 290 * MB), e('old', 1, 90 * MB), e('mid', 2, 50 * MB)])).toEqual(['old', 'mid'])
  })
  it('a single recording over the byte cap goes too (nothing kept can break the cap)', () => {
    expect(clampAudioPlan([e('huge', 1, MAX_BYTES + 1)])).toEqual(['huge'])
  })
  it('says sizes plainly', () => {
    expect(megabytes(4.2 * MB)).toBe('4.2 MB')
    expect(megabytes(300 * MB)).toBe('300 MB')
  })
})

describe('locate', () => {
  const takes = [{ offsetMs: 0, durationMs: 10_000 }, { offsetMs: 10_000, durationMs: 5_000 }]
  it('finds the take and the place in it', () => {
    expect(locate(takes, 0)).toEqual({ take: 0, withinMs: 0 })
    expect(locate(takes, 9_999)).toEqual({ take: 0, withinMs: 9_999 })
    expect(locate(takes, 12_000)).toEqual({ take: 1, withinMs: 2_000 })
  })
  it('clamps past the end and before the start', () => {
    expect(locate(takes, 99_000)).toEqual({ take: 1, withinMs: 5_000 })
    expect(locate(takes, -5)).toEqual({ take: 0, withinMs: 0 })
    expect(locate([], 5)).toBeNull()
  })
})

// ------------------------------------------------------------------ WebM
const bytes = (...xs) => Uint8Array.from(xs.flat())
const u = (n, len) => Array.from({ length: len }, (_, i) => Math.floor(n / 256 ** (len - 1 - i)) % 256)
const elt = (id, payload, sizeLen = 1) => [...u(id, id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1), ...encodeSize(payload.length, sizeLen), ...payload]
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0))

/** A head the way Chromium's MediaRecorder writes it: no Duration, unknown Segment size, then a Cluster. */
function chromiumHead({ knownSegment = false, withDurationAlready = false } = {}) {
  const ebml = elt(0x1a45dfa3, [...elt(0x4286, [1]), ...elt(0x4282, ascii('webm'))])
  const infoPayload = [...elt(0x2ad7b1, u(1_000_000, 3)), ...elt(0x4d80, ascii('Chrome')), ...elt(0x5741, ascii('Chrome'))]
  if (withDurationAlready) infoPayload.push(0x44, 0x89, 0x84, 0x46, 0x1c, 0x40, 0x00)
  const info = elt(0x1549a966, infoPayload, 8)
  const tracks = elt(0x1654ae6b, elt(0xae, [...elt(0xd7, [1]), ...elt(0x86, ascii('A_OPUS'))]))
  const cluster = [...u(0x1f43b675, 4), 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...elt(0xe7, [0])]
  const body = [...info, ...tracks, ...cluster]
  const segSize = knownSegment ? encodeSize(body.length, 8) : [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
  return bytes(ebml, u(0x18538067, 4), [...segSize], body)
}

function apply(head, edits) {
  const out = []
  let at = 0
  for (const e of edits) { out.push(...head.subarray(at, e.start), ...e.bytes); at = e.end }
  out.push(...head.subarray(at))
  return Uint8Array.from(out)
}

/** Reads Segment > Info > Duration (ms at the default TimecodeScale) out of a head; null if absent. */
function durationOf(b) {
  const ebml = readId(b, 0)
  const ebmlSize = readVint(b, ebml.length)
  let pos = ebml.length + ebmlSize.length + ebmlSize.value
  const seg = readId(b, pos)
  const segSize = readVint(b, pos + seg.length)
  pos += seg.length + segSize.length
  const info = readId(b, pos)
  const infoSize = readVint(b, pos + info.length)
  const start = pos + info.length + infoSize.length
  for (let p = start; p < start + infoSize.value;) {
    const id = readId(b, p)
    const size = readVint(b, p + id.length)
    if (id.id === 0x4489) return new DataView(b.buffer, b.byteOffset + p + id.length + size.length, 8).getFloat64(0)
    p += id.length + size.length + size.value
  }
  return null
}

describe('webm duration patch', () => {
  it('reads and writes EBML sizes', () => {
    expect(readVint(Uint8Array.from([0x81]), 0)).toEqual({ value: 1, length: 1, unknown: false })
    expect(readVint(Uint8Array.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), 0).unknown).toBe(true)
    expect([...encodeSize(300, 2)]).toEqual([0x41, 0x2c])
    expect(encodeSize(200, 1)).toBeNull()
  })
  it('adds the Duration into Info of a Chromium-style head (unknown Segment size)', () => {
    const head = chromiumHead()
    expect(durationOf(head)).toBeNull()
    const edits = durationEdits(head, 3_000_000)
    expect(edits).toHaveLength(1)
    const out = apply(head, edits)
    expect(durationOf(out)).toBe(3_000_000)
    // everything after Info is untouched (Tracks, the Cluster)
    expect([...out.subarray(out.length - 20)]).toEqual([...head.subarray(head.length - 20)])
  })
  it('grows a known Segment size by exactly the bytes added', () => {
    const head = chromiumHead({ knownSegment: true })
    const out = apply(head, durationEdits(head, 600_000))
    const segPos = readId(head, 0).length + readVint(head, 4).length + readVint(head, 4).value
    const before = readVint(head, segPos + 4).value
    const after = readVint(out, segPos + 4).value
    expect(after - before).toBe(out.length - head.length)
    expect(durationOf(out)).toBe(600_000)
  })
  it('leaves a head that already has a Duration, or is not WebM, alone', () => {
    expect(durationEdits(chromiumHead({ withDurationAlready: true }), 1000)).toBeNull()
    expect(durationEdits(Uint8Array.from([0, 0, 0, 0x18, ...ascii('ftypmp42')]), 1000)).toBeNull()
    expect(durationEdits(chromiumHead(), 0)).toBeNull()
  })
  it('withDuration patches a WebM blob without copying its body, and returns other blobs as they are', async () => {
    const head = chromiumHead()
    const body = new Uint8Array(200_000).fill(7)
    const blob = new Blob([head, body], { type: 'audio/webm;codecs=opus' })
    const out = await withDuration(blob, 12_345)
    expect(out.size - blob.size).toBe(11)
    expect(durationOf(new Uint8Array(await out.slice(0, 4096).arrayBuffer()))).toBe(12_345)
    const mp4 = new Blob([new Uint8Array(100)], { type: 'audio/mp4' })
    expect(await withDuration(mp4, 1000)).toBe(mp4)
  })
})

describe('webm duration patch never corrupts a file it cannot safely grow (review-app-a)', () => {
  const ebml = () => elt(0x1a45dfa3, [...elt(0x4286, [1]), ...elt(0x4282, ascii('webm'))])
  const info = (scale = u(1_000_000, 3)) => elt(0x1549a966, [...elt(0x2ad7b1, scale), ...elt(0x4d80, ascii('Chrome'))], 8)
  const cluster = [...u(0x1f43b675, 4), 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...elt(0xe7, [0])]
  const seekHead = elt(0x114d9b74, elt(0x4dbb, [...elt(0x53ab, u(0x1549a966, 4)), ...elt(0x53ac, [0])]))
  const cues = elt(0x1c53bb6b, elt(0xbb, [...elt(0xb3, [0]), ...elt(0xb7, [...elt(0xf7, [1]), ...elt(0xf1, [0x40])])]))
  const head = (...children) => bytes(ebml(), u(0x18538067, 4), [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], ...children)
  it('a SeekHead before Info (its positions would point wrong): unchanged', () => {
    expect(durationEdits(head(seekHead, info(), cluster), 5000)).toBeNull()
  })
  it('Cues after Info, before the first Cluster: unchanged', () => {
    expect(durationEdits(head(info(), cues, cluster), 5000)).toBeNull()
  })
  it('a zero or oversized TimecodeScale: unchanged (no Infinity written)', () => {
    expect(durationEdits(head(info([0, 0, 0]), cluster), 5000)).toBeNull()
    expect(durationEdits(head(info(u(1, 8)), cluster), 5000)).toBeNull()
  })
  it('a plain MediaRecorder head still gets its Duration', () => {
    expect(durationEdits(head(info(), cluster), 5000)).toHaveLength(1)
  })
  it('a 30 MB take: only the 64 KB head is read, the result is the take plus 11 bytes', async () => {
    const big = new Blob([head(info(), cluster), new Uint8Array(30 * MB)], { type: 'audio/webm' })
    let sliced = 0
    const slice = big.slice.bind(big)
    big.slice = (...a) => { sliced++; return slice(...a) }
    const out = await withDuration(big, 1_800_000)
    expect(out.size - big.size).toBe(11)
    expect(sliced).toBeLessThanOrEqual(3)
  })
  it('garbage typed as WebM comes back as the very same blob', async () => {
    const junk = new Blob([new Uint8Array(5000).fill(0x42)], { type: 'audio/webm' })
    expect(await withDuration(junk, 1000)).toBe(junk)
  })
})

describe('AudioStore never holds up "Reset this phone" (review-app-a)', () => {
  it('clear() settles within its timeout even when IndexedDB never answers (another tab blocking the delete)', async () => {
    const before = globalThis.indexedDB
    globalThis.indexedDB = {
      open: () => ({}),
      deleteDatabase: () => ({}), // never fires success, error or blocked
    }
    try {
      const store = new AudioStore('me')
      const t0 = Date.now()
      await store.clear(200)
      expect(Date.now() - t0).toBeLessThan(1500)
    } finally {
      globalThis.indexedDB = before
    }
  })
  it('clear() settles where there is no IndexedDB at all', async () => {
    const before = globalThis.indexedDB
    delete globalThis.indexedDB
    try {
      await new AudioStore('me').clear(200)
    } finally {
      if (before) globalThis.indexedDB = before
    }
  })
})
