/**
 * Live probe: the real TalkWeave adapter (createTalkWeaveCore) against a real
 * TalkWeave server and the real ASR proxy, over real HTTP and SSE.
 *
 * The only substitute is the microphone: speech is synthesised with macOS
 * `say`, converted to 16 kHz mono PCM16 with `afconvert`, and fed through
 * the same AudioSource seam the browser microphone uses. Phrase 1 is spoken
 * as speaker 1, then setSpeaker(2), then phrase 2.
 *
 * TalkWeave is started here on its own port (TW_PROBE_PORT, default 18990,
 * so it never collides with 8990) unless TW_PROBE_BASE points at one that is
 * already running. A server started here is killed afterwards.
 *
 * Run from apps/demo (it has the toolchain):
 *   cd <repo>/apps/demo && node_modules/.bin/vitest run \
 *     --config ../trustweb/test/e2e/vitest.probe.config.mjs --root ../trustweb
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createTalkWeaveCore, probeTalkWeave, TranscriberStatus } from '../../src/meeting_transcriber_core.ts'

const TALKWEAVE = process.env.TW_PROBE_TALKWEAVE
  ?? '/Users/personal/Documents/SingularStructure/PROJECTS/evobiosys/PROJECTS_evobiosys/evobioSYS-sys/PROJECTS_evobiosys-sys/TalkWeave'
const PORT = Number(process.env.TW_PROBE_PORT || 18990)
const BASE = process.env.TW_PROBE_BASE || `http://127.0.0.1:${PORT}`
const PHRASE_1 = 'Hello, I am Anna and I am looking for a carpenter.'
const PHRASE_2 = 'I know a carpenter in Vienna who can help.'

let child = null
let tmp = ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitHealthy(url, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url + '/api/health')).ok) return true } catch { /* not up yet */ }
    await sleep(300)
  }
  return false
}

/** PCM16 bytes of the data chunk of a RIFF/WAVE file (afconvert adds extra chunks). */
function wavData(buf) {
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') return new Uint8Array(buf.subarray(off + 8, off + 8 + size))
    off += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

function synth(text, name) {
  const aiff = path.join(tmp, name + '.aiff')
  const wav = path.join(tmp, name + '.wav')
  execFileSync('say', ['-o', aiff, text])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav])
  return wavData(readFileSync(wav))
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'tw-probe-'))
  if (process.env.TW_PROBE_BASE) return
  child = spawn('node', ['server/server.mjs'], { cwd: TALKWEAVE, env: { ...process.env, TALKWEAVE_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => process.stdout.write('[talkweave] ' + d))
  child.stderr.on('data', (d) => process.stderr.write('[talkweave] ' + d))
  if (!(await waitHealthy(BASE, 20_000))) throw new Error('TalkWeave did not start on ' + BASE)
})

afterAll(() => {
  if (child) { child.kill('SIGTERM'); child = null }
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('TalkWeave live probe', () => {
  it('TalkWeave answers with an engine (probeTalkWeave)', async () => {
    const res = await fetch(BASE + '/api/whisper/available')
    console.log('whisper/available:', JSON.stringify(await res.json()))
    expect(await probeTalkWeave(BASE, fetch, 5000)).toBe(true)
  })

  it('does not reject a request carrying an Origin header (so the proxy need not strip it)', async () => {
    const url = new URL(BASE + '/api/health')
    const status = await new Promise((resolve, reject) => {
      http.get({ host: url.hostname, port: url.port, path: url.pathname, headers: { Origin: 'https://example.org', Host: 'evil.example.com' } }, (r) => { r.resume(); resolve(r.statusCode) }).on('error', reject)
    })
    console.log('health with Origin + foreign Host header ->', status)
    expect(status).toBe(200)
  })

  it('transcribes two spoken phrases into two finals labelled speaker 1 and 2', async () => {
    const pcm1 = synth(PHRASE_1, 'p1')
    const pcm2 = synth(PHRASE_2, 'p2')
    const CHUNK = 8192 // bytes = 256 ms at 16 kHz mono PCM16
    let onChunk = null
    const audio = {
      start: async (cb) => { onChunk = cb },
      setEnabled: () => {},
      stop: () => { onChunk = null },
    }
    const core = createTalkWeaveCore({ base: BASE, fetchFn: fetch, audio, now: Date.now, flushTimeoutMs: 60_000 })
    const segs = []
    const statuses = []
    core.onSegment((s) => segs.push(s))
    core.onStatus((s) => statuses.push(s))

    await core.start()
    expect(statuses).toEqual([TranscriberStatus.Listening])

    const feed = async (pcm) => {
      for (let i = 0; i < pcm.length; i += CHUNK) {
        onChunk(pcm.subarray(i, Math.min(i + CHUNK, pcm.length)))
        await sleep(100) // about 2.5x real time
      }
    }
    await feed(pcm1)
    await sleep(1500)
    core.setSpeaker(2)
    await sleep(200)
    await feed(pcm2)
    await core.stop()

    const finals = segs.filter((s) => s.final)
    console.log('segments (all versions):', JSON.stringify(segs))
    console.log('finals:', JSON.stringify(finals))
    expect(statuses[statuses.length - 1]).toBe(TranscriberStatus.Idle)
    expect(finals.length).toBeGreaterThanOrEqual(2)
    expect(finals[0].speaker).toBe(1)
    expect(finals[finals.length - 1].speaker).toBe(2)
    const said1 = finals.filter((s) => s.speaker === 1).map((s) => s.text).join(' ').toLowerCase()
    const said2 = finals.filter((s) => s.speaker === 2).map((s) => s.text).join(' ').toLowerCase()
    expect(said1).toContain('carpenter')
    expect(said2).toContain('vienna')
    expect(segs.some((s) => !s.final)).toBe(true) // live partials were seen too
  })
})
