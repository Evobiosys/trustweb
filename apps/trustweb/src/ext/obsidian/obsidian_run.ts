// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: runs the batches through the model one at a time, with Pause / Resume / Stop. `ask` null (no endpoint) means nothing is
 * read or sent. A reply that fails or is not the schema is tried once more, then its notes are marked failed and the run goes on. Pure: the
 * endpoint call and the file reads are injected.
 */
import { SYSTEM_PROMPT, buildUser, mergePeople, progressOf, validateExtraction } from './obsidian_ingest'
import type { Batch, ExtractedPerson } from './obsidian_ingest'

export interface IngestProgress { doneBatches: number; totalBatches: number; pct: number; etaMs: number | null }
export interface IngestResult { status: 'done' | 'stopped' | 'no-endpoint'; people: ExtractedPerson[]; donePaths: string[]; failed: string[]; dropped: number }
export interface IngestOptions {
  batches: readonly Batch[]
  /** The text of one note; null when it cannot be read. */
  load: (path: string) => Promise<string | null>
  ask: ((system: string, user: string) => Promise<unknown>) | null
  onProgress?: (p: IngestProgress) => void
  /** After every batch: what was found and read so far, merged (the app keeps it, so a closed page can carry on). */
  onBatch?: (so_far: { people: ExtractedPerson[]; donePaths: string[] }) => void
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

  async function attempt(batch: Batch, texts: readonly { path: string; text: string }[]): Promise<{ people: ExtractedPerson[]; dropped: number } | null> {
    for (let i = 0; i < 2; i++) {
      try {
        const v = validateExtraction(await o.ask!(SYSTEM_PROMPT, buildUser(texts)), batch.items.map((x) => x.path))
        if (v.valid) return { people: v.people, dropped: v.dropped }
      } catch { /* tried once more */ }
    }
    return null
  }

  return {
    state: () => state,
    pause(): void { if (state === 'running') state = 'paused' },
    resume(): void { if (state === 'paused') { state = 'running'; release() } },
    stop(): void { if (state === 'running' || state === 'paused') { state = 'stopped'; release() } },
    async run(): Promise<IngestResult> {
      const lists: ExtractedPerson[][] = o.resume ? [[...o.resume.people]] : []
      const result: IngestResult = { status: 'done', people: [], donePaths: [...(o.resume?.donePaths ?? [])], failed: [], dropped: 0 }
      if (!o.ask) return { ...result, status: 'no-endpoint' }
      state = 'running'
      let spent = 0
      let done = 0
      for (const batch of o.batches) {
        while (is('paused')) await gate()
        if (is('stopped')) break
        const t0 = now()
        const texts = (await Promise.all(batch.items.map(async (x) => ({ path: x.path, text: await o.load(x.path) })))).filter((x): x is { path: string; text: string } => x.text !== null)
        const paths = batch.items.map((x) => x.path)
        const got = texts.length ? await attempt(batch, texts) : { people: [], dropped: 0 }
        if (is('stopped') && !got) break
        if (got) { lists.push(got.people); result.dropped += got.dropped; result.donePaths.push(...paths) } else result.failed.push(...paths)
        spent += now() - t0
        done++
        o.onBatch?.({ people: mergePeople(lists), donePaths: [...result.donePaths] })
        o.onProgress?.({ doneBatches: done, totalBatches: o.batches.length, ...progressOf(done, o.batches.length, spent) })
      }
      result.people = mergePeople(lists)
      result.status = is('stopped') ? 'stopped' : 'done'
      if (!is('stopped')) state = 'done'
      return result
    },
  }
}
