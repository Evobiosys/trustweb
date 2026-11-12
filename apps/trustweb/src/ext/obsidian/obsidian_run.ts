// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: runs the batches through the model one at a time, with Pause / Resume / Stop. `ask` null (no endpoint) means nothing is
 * read or sent. A reply that fails or is not the schema is tried once more, then its notes are marked failed and the run goes on. Pure: the
 * endpoint call and the file reads are injected.
 */
import { SYSTEM_PROMPT, buildUser, createMerger, progressOf, validateExtraction } from './obsidian_ingest'
import type { Batch, ExtractedPerson } from './obsidian_ingest'

export interface IngestProgress { doneBatches: number; totalBatches: number; pct: number; etaMs: number | null }
export interface IngestResult { status: 'done' | 'stopped' | 'no-endpoint'; people: ExtractedPerson[]; donePaths: string[]; failed: string[]; dropped: number }
/** An unfinished run as the app keeps it: the vault it belongs to and the hash of each note it has read (a note edited since is read again). */
export interface StoredRun { vault: string; hashes: Record<string, string>; people: ExtractedPerson[] }

/** What of a kept run still counts: nothing for another vault or an old-format run; for the same vault the notes whose text is unchanged. */
export function resumable(run: Partial<StoredRun> | undefined, vault: string, current: Readonly<Record<string, string>>): { people: ExtractedPerson[]; donePaths: string[] } | null {
  if (!run || run.vault !== vault || !run.hashes || !Array.isArray(run.people)) return null
  const donePaths = Object.entries(run.hashes).filter(([p, h]) => current[p] === h).map(([p]) => p)
  return donePaths.length || run.people.length ? { people: run.people, donePaths } : null
}

let active = false
/**
 * One ingestion run at a time: in this page (module flag) and, where the browser has Web Locks, across tabs. Resolves to the release function, or
 * null when a run is already going. A lock held by another tab is not waited for.
 */
export async function claimRun(locks: Pick<LockManager, 'request'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks): Promise<(() => void) | null> {
  if (active) return null
  active = true
  if (!locks) return () => { active = false }
  return new Promise((resolve) => {
    let free = (): void => undefined
    void locks.request('trustweb-obsidian-ingest', { ifAvailable: true }, (lock) => {
      if (!lock) { active = false; resolve(null); return undefined }
      resolve(() => { active = false; free() })
      return new Promise<void>((r) => { free = r })
    })
  })
}

const shutdowns = new Set<() => void>()
/** The open page registers how it ends everything it started; the module being switched off and "Forget this vault" call them all (B6, B15). Returns the unregister. */
export const onShutdown = (f: () => void): (() => void) => { shutdowns.add(f); return () => { shutdowns.delete(f) } }
export const shutdownAll = (): void => { for (const f of [...shutdowns]) f() }

export interface IngestOptions {
  batches: readonly Batch[]
  /** The text of one note; null when it cannot be read. */
  load: (path: string) => Promise<string | null>
  ask: ((system: string, user: string, signal?: AbortSignal) => Promise<unknown>) | null
  onProgress?: (p: IngestProgress) => void
  /** What was found and read so far, merged (the app keeps it, so a closed page can carry on): every `snapshotEvery` batches and when the run pauses, stops or ends. */
  onBatch?: (so_far: { people: ExtractedPerson[]; donePaths: string[] }) => void
  snapshotEvery?: number
  now?: () => number
  /** An earlier run's people and done notes (kept, not asked again). */
  resume?: { people: readonly ExtractedPerson[]; donePaths: readonly string[] }
}

export function createIngest(o: IngestOptions) {
  const now = o.now ?? Date.now
  type State = 'idle' | 'running' | 'paused' | 'stopped' | 'done'
  let state: State = 'idle'
  // pause() and stop() change `state` while run() awaits: read it through a function so the checks are not narrowed away.
  const is = (s: State): boolean => state === s
  let wake: (() => void) | null = null
  const gate = (): Promise<void> => new Promise((r) => { wake = r })
  const release = (): void => { const w = wake; wake = null; w?.() }
  // Stop aborts the request in flight, and no second try follows it.
  const abort = new AbortController()
  const merger = createMerger()
  const result: IngestResult = { status: 'done', people: [], donePaths: [...(o.resume?.donePaths ?? [])], failed: [], dropped: 0 }
  const every = o.snapshotEvery ?? 1
  let unsaved = 0
  const snapshot = (): void => { unsaved = 0; o.onBatch?.({ people: merger.people(), donePaths: [...result.donePaths] }) }

  async function attempt(batch: Batch, texts: readonly { path: string; text: string }[]): Promise<{ people: ExtractedPerson[]; dropped: number } | null> {
    for (let i = 0; i < 2 && !is('stopped'); i++) {
      try {
        const v = validateExtraction(await o.ask!(SYSTEM_PROMPT, buildUser(texts), abort.signal), batch.items.map((x) => x.path))
        if (v.valid) return { people: v.people, dropped: v.dropped }
      } catch { /* tried once more, unless stopped */ }
    }
    return null
  }

  return {
    state: () => state,
    pause(): void { if (state === 'running') state = 'paused' },
    resume(): void { if (state === 'paused') { state = 'running'; release() } },
    stop(): void { if (state === 'running' || state === 'paused') { state = 'stopped'; abort.abort(); release() } },
    async run(): Promise<IngestResult> {
      if (!o.ask) return { ...result, status: 'no-endpoint' }
      if (o.resume) merger.add(o.resume.people)
      state = 'running'
      let spent = 0
      let done = 0
      for (const batch of o.batches) {
        while (is('paused')) { if (unsaved) snapshot(); await gate() }
        if (is('stopped')) break
        const t0 = now()
        const texts = (await Promise.all(batch.items.map(async (x) => ({ path: x.path, text: await o.load(x.path) })))).filter((x): x is { path: string; text: string } => x.text !== null)
        if (is('stopped')) break
        const paths = batch.items.map((x) => x.path)
        const got = texts.length ? await attempt(batch, texts) : { people: [], dropped: 0 }
        if (is('stopped') && !got) break
        if (got) { merger.add(got.people); result.dropped += got.dropped; result.donePaths.push(...paths) } else result.failed.push(...paths)
        spent += now() - t0
        done++
        if (++unsaved >= every) snapshot()
        o.onProgress?.({ doneBatches: done, totalBatches: o.batches.length, ...progressOf(done, o.batches.length, spent) })
      }
      if (unsaved) snapshot()
      result.people = merger.people()
      result.status = is('stopped') ? 'stopped' : 'done'
      if (!is('stopped')) state = 'done'
      return result
    },
  }
}
