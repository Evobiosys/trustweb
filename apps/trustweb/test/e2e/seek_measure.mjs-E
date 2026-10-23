/**
 * Seek accuracy of kept recordings (wave 1733, item 4b / amendment A4), at
 * 10 s, 10 min and 50 min, in headless Chromium and WebKit.
 *
 * The take: 13 s recorded by the browser's own MediaRecorder at 32 kbit/s from
 * a time-coded test signal (a tone whose pitch steps every 0.5 s: 300 Hz + 20 Hz
 * per step, 26 steps), so where playback really is can be heard back, not only
 * read from currentTime. The long takes are made from it synthetically, as A4
 * allows: its clusters repeated with rewritten cluster timecodes (no cues, no
 * Duration, like a MediaRecorder file), 50+ minutes in about 12 MB. Then the
 * app's own webm_duration.ts writes the Duration, and each target is played
 * from a Blob URL through an <audio> element, as the app does.
 *
 * Reported per browser and target: currentTime right after the seek and once
 * playing, and the pitch heard (which 0.5 s step of the 13 s signal), against
 * what the target expects. No server: about:blank pages, the files handed over
 * by page.route. Run (about 2 minutes, mostly the 13 s recordings):
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/seek_measure.mjs
 */
import { durationEdits, encodeSize, readId, readVint } from '../../src/webm_duration.ts'

const PERIOD_S = 13
const TARGETS_S = [10, 600, 3000]
const LONG_S = 3060

/** In the page: record PERIOD_S of the time-coded signal with MediaRecorder; resolves to { b64, type }. */
const recordSignal = async ({ seconds, mime }) => {
  const ctx = new AudioContext({ sampleRate: 48000 })
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  gain.gain.value = 0.4
  const t0 = ctx.currentTime + 0.05
  for (let k = 0; k < seconds * 2; k++) osc.frequency.setValueAtTime(300 + 20 * (k % 26), t0 + k * 0.5)
  const dest = ctx.createMediaStreamDestination()
  osc.connect(gain).connect(dest)
  const type = MediaRecorder.isTypeSupported(mime) ? mime : ''
  const rec = new MediaRecorder(dest.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 })
  const chunks = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise((r) => { rec.onstop = r })
  osc.start(t0)
  rec.start(1000)
  await new Promise((r) => setTimeout(r, seconds * 1000 + 100))
  rec.stop()
  await stopped
  const blob = new Blob(chunks, { type: rec.mimeType })
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return { b64: btoa(s), type: rec.mimeType }
}

/** In the page: load url into an <audio>, seek to each target, play, and report what is heard. */
const measure = async ({ url, type, targets }) => {
  const res = await fetch(url)
  const blob = new Blob([await res.arrayBuffer()], { type })
  const a = document.createElement('audio')
  if (!a.canPlayType(type.split(';')[0])) return { playable: false }
  a.src = URL.createObjectURL(blob)
  document.body.append(a)
  await new Promise((r) => { a.onloadedmetadata = r; a.onerror = r; setTimeout(r, 8000) })
  const ctx = new AudioContext()
  const an = ctx.createAnalyser()
  an.fftSize = 8192
  ctx.createMediaElementSource(a).connect(an)
  an.connect(ctx.destination)
  const pitch = () => {
    const bins = new Float32Array(an.frequencyBinCount)
    an.getFloatFrequencyData(bins)
    let best = 0
    for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i
    return best * ctx.sampleRate / an.fftSize
  }
  const out = { playable: true, duration: a.duration, results: [] }
  for (const t of targets) {
    a.pause()
    const seeked = new Promise((r) => { a.onseeked = r; setTimeout(r, 15000) })
    const s0 = performance.now()
    a.currentTime = t
    await seeked
    const seekMs = performance.now() - s0
    const afterSeek = a.currentTime
    await ctx.resume()
    await a.play().catch(() => {})
    await new Promise((r) => setTimeout(r, 260))
    const heardHz = pitch()
    const playingAt = a.currentTime
    out.results.push({ target: t, afterSeek, playingAt, heardHz, seekMs: Math.round(seekMs) })
  }
  a.pause()
  return out
}

// ------------------------------------------------------- the long take, in Node
function clustersOf(b) {
  const ebml = readId(b, 0)
  const ebmlSize = readVint(b, ebml.length)
  const segPos = ebml.length + ebmlSize.length + ebmlSize.value
  const seg = readId(b, segPos)
  const segSize = readVint(b, segPos + seg.length)
  let pos = segPos + seg.length + segSize.length
  const headEnd = (() => {
    let p = pos
    while (p < b.length) {
      const id = readId(b, p)
      if (id.id === 0x1f43b675) return p
      const size = readVint(b, p + id.length)
      p += id.length + size.length + size.value
    }
    return p
  })()
  const clusters = []
  pos = headEnd
  while (pos < b.length) {
    const id = readId(b, pos)
    if (!id || id.id !== 0x1f43b675) break
    const size = readVint(b, pos + id.length)
    let p = pos + id.length + size.length
    const end = size.unknown ? b.length : p + size.value
    let timecode = 0
    const blocks = []
    while (p < end) {
      const cid = readId(b, p)
      if (!cid || cid.id === 0x1f43b675) break
      const cs = readVint(b, p + cid.length)
      const payload = p + cid.length + cs.length
      if (cid.id === 0xe7) { timecode = 0; for (let i = 0; i < cs.value; i++) timecode = timecode * 256 + b[payload + i] }
      else blocks.push(b.subarray(p, payload + cs.value))
      p = payload + cs.value
    }
    clusters.push({ timecode, blocks })
    pos = p
  }
  return { head: b.subarray(0, headEnd), clusters }
}

function cluster(timecodeMs, blocks) {
  const tc = Buffer.alloc(8)
  tc.writeBigUInt64BE(BigInt(timecodeMs))
  const body = Buffer.concat([Buffer.from([0xe7, 0x88]), tc, ...blocks.map((x) => Buffer.from(x))])
  return Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75]), Buffer.from(encodeSize(body.length, 8)), body])
}

function longTake(bytes, periodMs, totalS) {
  const { head, clusters } = clustersOf(bytes)
  const parts = [Buffer.from(head)]
  for (let copy = 0; copy * periodMs < totalS * 1000; copy++) {
    for (const c of clusters) parts.push(cluster(copy * periodMs + c.timecode, c.blocks))
  }
  return Buffer.concat(parts)
}

function withDurationBytes(b, ms) {
  const edits = durationEdits(new Uint8Array(b.subarray(0, 65536)), ms)
  if (!edits) return b
  const out = []
  let at = 0
  for (const e of edits) { out.push(b.subarray(at, e.start), Buffer.from(e.bytes)); at = e.end }
  out.push(b.subarray(at))
  return Buffer.concat(out)
}

/** What the signal says at time t: the expected pitch step. */
const expectedHz = (t) => 300 + 20 * (Math.floor((t % PERIOD_S) * 2) % 26)

async function run(engineName, engine, chromiumLong) {
  const browser = await engine.launch({ headless: true, args: engineName === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] })
  const lines = []
  let longOut = null
  try {
    const page = await browser.newPage()
    const files = new Map()
    await page.route('https://seek.test/**', (route) => {
      const f = files.get(new URL(route.request().url()).pathname)
      return f ? route.fulfill({ body: f.body, contentType: f.type, headers: { 'Access-Control-Allow-Origin': '*' } }) : route.fulfill({ status: 404 })
    })
    await page.goto('about:blank')
    const own = await page.evaluate(recordSignal, { seconds: PERIOD_S, mime: 'audio/webm;codecs=opus' })
    const ownBytes = Buffer.from(own.b64, 'base64')
    lines.push(`${engineName}: recorded ${PERIOD_S} s as ${own.type}, ${ownBytes.length} bytes`)
    const report = (label, r) => {
      if (!r.playable) { lines.push(`  ${label}: not playable in ${engineName}`); return }
      lines.push(`  ${label}: duration ${r.duration}`)
      for (const x of r.results) {
        const exp = expectedHz(x.target)
        const heardStep = Math.round((x.heardHz - 300) / 20)
        const expStep = Math.round((exp - 300) / 20)
        lines.push(`    target ${x.target} s: after seek ${x.afterSeek.toFixed(3)} s (error ${((x.afterSeek - x.target) * 1000).toFixed(0)} ms), playing at ${x.playingAt.toFixed(3)} s, heard ${x.heardHz.toFixed(0)} Hz = step ${heardStep}, expected step ${expStep} or ${expStep + 1} (0.5 s steps), seek took ${x.seekMs} ms`)
      }
    }
    if (/webm/.test(own.type)) {
      const long = longTake(ownBytes, PERIOD_S * 1000, LONG_S)
      const patched = withDurationBytes(long, LONG_S * 1000)
      longOut = patched
      files.set('/long-raw.webm', { body: long, type: own.type })
      files.set('/long.webm', { body: patched, type: own.type })
      lines.push(`  synthetic long take: ${LONG_S} s, ${long.length} bytes (Duration written: +${patched.length - long.length} bytes)`)
      report('long take WITHOUT Duration (as MediaRecorder leaves it)', await page.evaluate(measure, { url: 'https://seek.test/long-raw.webm', type: own.type, targets: TARGETS_S }))
      report('long take WITH Duration (as the app keeps it)', await page.evaluate(measure, { url: 'https://seek.test/long.webm', type: own.type, targets: TARGETS_S }))
    } else {
      files.set('/own', { body: ownBytes, type: own.type })
      lines.push(`  ${engineName} records ${own.type}: no synthetic long take for this container (only WebM is rebuilt here); measured at 10 s on its own take`)
      report(`own ${PERIOD_S} s take`, await page.evaluate(measure, { url: 'https://seek.test/own', type: own.type, targets: [10] }))
    }
    // Chromium's long take (Duration written) opened here too, where this engine plays WebM at all.
    if (chromiumLong && !/webm/.test(own.type)) {
      files.set('/chromium-long.webm', { body: chromiumLong, type: 'audio/webm;codecs=opus' })
      report('Chromium\'s long WebM take (Duration written)', await page.evaluate(measure, { url: 'https://seek.test/chromium-long.webm', type: 'audio/webm;codecs=opus', targets: TARGETS_S }))
    }
  } catch (e) {
    lines.push(`${engineName}: ERROR ${e.message}`)
  } finally {
    await browser.close()
  }
  return { lines, longOut }
}

const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
const lib = pw.chromium ? pw : pw.default
const chromium = await run('chromium', lib.chromium, null)
chromium.lines.forEach((l) => console.log(l))
const webkit = await run('webkit', lib.webkit, chromium.longOut)
webkit.lines.forEach((l) => console.log(l))
