// The demo debrief's "you may have overshared, backtrace and clear" path,
// end to end, after the signing scheme landed (B-20 option A).
//
// This is the one test that crosses the package boundary for real: the DEMO's
// own client adapter talks over HTTP to the SHIPPED central-index binary
// (src/bin.ts, run through tsx the way packages/relay-crypto's cli_unseal test
// runs its own CLI), on an ephemeral loopback port, against a throwaway data
// directory. No stubbed fetch, no re-implemented canonicalisation on either
// side -- if the device's canonical message and the server's ever drift apart,
// the clear below fails and this test goes red.
//
// The server process is started in beforeAll and killed in afterAll, including
// on failure. Nothing is left listening.
//
// NO BROWSER. apps/demo has no Playwright dependency on purpose (the central
// handover names this as build-session trap 5); this drives the adapter
// functions directly.

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import * as client from '../src/central/client'
import { SIGNING_KEY_STORAGE_KEY, getOrCreateSigningKey, resetSigningKeyCache } from '../src/central/signing'
import { kvDel } from '../src/db'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const tsxBin = join(repoRoot, 'node_modules', '.bin', 'tsx')
const centralBin = join(repoRoot, 'packages', 'central-index', 'src', 'bin.ts')

const STARTUP_TIMEOUT_MS = 30_000
// Every central-index response is padded to CENTRAL_BUDGET_MS (900ms), so a
// four-request walk costs about four seconds before any assertion is wrong.
const WALK_TIMEOUT_MS = 40_000

/** stdio is ['ignore','pipe','pipe'], so stdin is null and both readable
 *  streams are typed non-null. */
type ServerProcess = ChildProcessByStdio<null, Readable, Readable>

let child: ServerProcess | undefined
let dataDir = ''
let origin = ''

function startServer(): Promise<string> {
  dataDir = mkdtempSync(join(tmpdir(), 'wot-central-demo-e2e-'))
  const proc: ServerProcess = spawn(tsxBin, [centralBin], {
    env: {
      ...process.env,
      WOT_CENTRAL_PORT: '0', // ephemeral: never collides with a real instance
      WOT_CENTRAL_DATA: dataDir,
      WOT_CENTRAL_JURISDICTION: 'at',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child = proc

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('central-index did not report a port in time')), STARTUP_TIMEOUT_MS)
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      const match = /listening on 127\.0\.0\.1:(\d+)/.exec(chunk.toString('utf-8'))
      if (match) {
        clearTimeout(timer)
        resolve(`http://127.0.0.1:${match[1]}`)
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`central-index exited early (code ${String(code)}): ${stderr}`))
    })
  })
}

async function stopServer(): Promise<void> {
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child?.once('exit', () => resolve()))
    child.kill('SIGTERM')
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 5_000))])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  child = undefined
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
}

describe('e2e: backtrace and clear, demo adapter against the shipped central-index binary', () => {
  const authorCommitment = 'author-demo-e2e-backtrace-clear'

  beforeAll(async () => {
    resetSigningKeyCache()
    await kvDel(SIGNING_KEY_STORAGE_KEY)
    origin = await startServer()
    vi.stubEnv('VITE_WOT_CENTRAL', 'on')
    vi.stubEnv('VITE_WOT_CENTRAL_ORIGIN', origin)
  }, STARTUP_TIMEOUT_MS)

  afterAll(async () => {
    vi.unstubAllEnvs()
    resetSigningKeyCache()
    await kvDel(SIGNING_KEY_STORAGE_KEY)
    await stopServer()
  })

  it(
    'publish, see it in the backtrace, clear it, and it is gone',
    async () => {
      const published = await client.publish({
        facets: { category: 'accommodation.sublet', regionCode: 'AT-9', authorCommitment, sensitive: false },
        sealedBody: 'sealed-opaque-demo-e2e',
        soleAuthorAck: true,
      })
      expect(published, JSON.stringify(published)).toMatchObject({ kind: 'ok' })

      const before = await client.backtrace(authorCommitment)
      expect(before.kind).toBe('ok')
      const rows = (before as { data: Array<{ id: string; residency: string }> }).data
      expect(rows).toHaveLength(1)
      expect(rows[0].residency).toBe('AT')

      const cleared = await client.clearAll(authorCommitment)
      expect(cleared, JSON.stringify(cleared)).toMatchObject({ kind: 'ok' })

      const after = await client.backtrace(authorCommitment)
      expect((after as { data: unknown[] }).data).toEqual([])
    },
    WALK_TIMEOUT_MS,
  )

  it(
    'the same walk is refused when the request is not signed by the publishing device',
    async () => {
      // Re-publish, then re-key the device (as a new install would) and try to
      // clear. The server accepts the request -- the signature is valid -- but
      // scopes the erase to what THAT key published, which is nothing.
      const published = await client.publish({
        facets: { category: 'accommodation.sublet', regionCode: 'AT-9', authorCommitment, sensitive: false },
        sealedBody: 'sealed-opaque-demo-e2e-2',
        soleAuthorAck: true,
      })
      expect(published).toMatchObject({ kind: 'ok' })

      resetSigningKeyCache()
      await kvDel(SIGNING_KEY_STORAGE_KEY)
      const rekeyed = await getOrCreateSigningKey()
      expect(rekeyed.publicKeyB64u).toBeTruthy()

      const cleared = await client.clearAll(authorCommitment)
      expect(cleared).toMatchObject({ kind: 'ok' })

      const after = await client.backtrace(authorCommitment)
      expect((after as { data: unknown[] }).data).toHaveLength(1)
    },
    WALK_TIMEOUT_MS,
  )
})
