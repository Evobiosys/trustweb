/**
 * The record with every field round B adds (wave 1733, A9 data-safety rules):
 * it stays a readable v1 record, the round-A migration leaves the new fields
 * alone, odd shapes of them never throw and are never written over, and a
 * pre-wave record (without them) still reads as before (Feed on, nothing
 * hosted, no consent, Automatic transcription).
 */
import { feedOn, transcriptionChoice, TranscriptionChoice } from '../../src/model.ts'
import { migrateSources } from '../../src/provenance.ts'
import { parseRecord } from '../../src/store.ts'
import { createSwissContext, readHosting } from '../../src/swiss_context.ts'
import { settleInterruptedJobs } from '../../src/server_transcription.ts'
import { lastImport } from '../../src/inventory_import.ts'
import { buildFeed } from '../../src/feed.ts'
import { HOSTED_SECRET, preWaveState, roundBFields, roundBState } from '../fixtures/pre_wave_state.mjs'

describe('the round-B record', () => {
  it('is a readable v1 record; the round-A migration does not touch the round-B fields', () => {
    const s = roundBState()
    expect(parseRecord(JSON.stringify(s))).not.toBe(null)
    const before = roundBFields(s)
    migrateSources(s)
    expect(roundBFields(s)).toBe(before)
  })
  it('reads its settings: the Swiss server chosen, the Feed on, the hosted account there', () => {
    const s = roundBState()
    expect(transcriptionChoice(s)).toBe(TranscriptionChoice.Server)
    expect(feedOn(s)).toBe(true)
    expect(readHosting(s)?.secret).toBe(HOSTED_SECRET)
    expect(lastImport(s)?.id).toBe('imp-batch-2')
  })
  it('a pre-wave record reads as before: Automatic, Feed on, nothing hosted, nothing imported', () => {
    const s = preWaveState()
    expect(transcriptionChoice({ ...s, talkWeaveLocal: false })).toBe(TranscriptionChoice.Auto)
    expect(feedOn(s)).toBe(true)
    expect(readHosting(s)).toBe(null)
    expect(lastImport(s)).toBe(null)
    expect(() => buildFeed(s)).not.toThrow()
  })
  it('odd shapes never throw, and a hosting state that cannot be read is never written over', async () => {
    for (const odd of [null, 'x', { secret: 'short', on: true }, { secret: HOSTED_SECRET, recs: 'no' }]) {
      const s = { ...preWaveState(), hosting: odd, imports: odd, feed: odd, meetings: [null, { id: 'x', serverJob: odd }] }
      expect(() => settleInterruptedJobs(s.meetings)).not.toThrow()
      expect(() => lastImport(s)).not.toThrow()
      expect(() => feedOn(s)).not.toThrow()
      expect(() => buildFeed({ ...preWaveState(), feed: odd })).not.toThrow()
    }
    for (const bad of [{ secret: 'not-a-secret', on: true, recs: [] }, { secret: HOSTED_SECRET, on: true, recs: 'odd' }]) {
      const t = { ...preWaveState(), hosting: bad }
      expect(readHosting(t)).toBe(null)
      expect(() => createSwissContext({ state: () => t, save: () => {}, enabled: () => true }).hosting()).toThrow()
      expect(t.hosting).toBe(bad)
    }
    const s = { ...preWaveState(), hosting: { secret: 'not-a-secret', on: true, recs: [] } }
    const ctx = createSwissContext({ state: () => s, save: () => {}, enabled: () => true })
    expect(() => ctx.hosting()).toThrow()
    await expect(ctx.account()).rejects.toThrow()
    expect(s.hosting.secret).toBe('not-a-secret')
  })
  it('the hosted account is never made on a demo phone or account', async () => {
    const s = preWaveState()
    const ctx = createSwissContext({ state: () => s, save: () => {}, enabled: () => false })
    await expect(ctx.account()).rejects.toThrow()
    expect(await ctx.probe()).toBe(null)
    expect(s.hosting).toBe(undefined)
  })
})
