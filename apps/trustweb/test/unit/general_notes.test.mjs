/**
 * The General note on a person (src/general_notes.ts, notes_advanced_memory.ts, wave 6e): what is stored, the boot repair, the debounced
 * autosave, the two-minute memory of "the Advanced disclosure was open" (clock injected), the transcribing state, and the PRIVACY guards:
 * the note never reaches the matcher input of an ask, and the source is scanned for every place that names the field.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERAL_NOTE_DEBOUNCE_MS, GENERAL_NOTE_MAX, cleanGeneralNote, createAutosaver, generalNoteMatches, generalNoteOf, repairGeneralNotes, setGeneralNote,
} from '../../src/general_notes.ts'
import { ADVANCED_MEMORY_MS, createAdvancedMemory, localStorageCell } from '../../src/notes_advanced_memory.ts'
import { askSources } from '../../src/cascade.ts'
import { pendingTranscripts, transcriptPending } from '../../src/person_notes.ts'
import { Audience, LineStatus, Ring, ServerJobState, Tag } from '../../src/model.ts'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

describe('what is stored', () => {
  it('plain text is kept as typed, line breaks as \\n, control characters removed', () => {
    expect(cleanGeneralNote('  Met at the market.\r\nLikes chess\u0000.\t ')).toBe('  Met at the market.\nLikes chess.\t ')
  })
  it('white space only reads as none; non-strings read as none', () => {
    expect(cleanGeneralNote('  \n\t ')).toBe('')
    for (const v of [undefined, null, 5, {}, []]) expect(cleanGeneralNote(v)).toBe('')
  })
  it('is capped at 4000 characters and never cuts an emoji in half', () => {
    expect(cleanGeneralNote('a'.repeat(GENERAL_NOTE_MAX + 50))).toHaveLength(GENERAL_NOTE_MAX)
    const cut = cleanGeneralNote('a'.repeat(GENERAL_NOTE_MAX - 1) + '😀')
    expect(cut).toBe('a'.repeat(GENERAL_NOTE_MAX - 1))
    expect(cleanGeneralNote('a'.repeat(GENERAL_NOTE_MAX - 2) + '😀')).toHaveLength(GENERAL_NOTE_MAX)
  })
  it('setGeneralNote: stores, reports a change, is idempotent, removes the field when emptied', () => {
    const p = {}
    expect(setGeneralNote(p, 'hello')).toBe(true)
    expect(p.generalNote).toBe('hello')
    expect(setGeneralNote(p, 'hello')).toBe(false)
    expect(generalNoteOf(p)).toBe('hello')
    expect(setGeneralNote(p, '   ')).toBe(true)
    expect('generalNote' in p).toBe(false)
    expect(setGeneralNote(p, '')).toBe(false)
  })
  it('a note written as a person types keeps its spaces (no trimming of a line being written)', () => {
    const p = {}
    setGeneralNote(p, 'one ')
    expect(p.generalNote).toBe('one ')
  })
})

describe('boot repair (never throws)', () => {
  it('drops a note that is not text, cuts an over-long one, removes an empty one, leaves a good one untouched', () => {
    const state = { people: [{ id: 'a', generalNote: 5 }, { id: 'b', generalNote: 'x'.repeat(GENERAL_NOTE_MAX + 9) }, { id: 'c', generalNote: '  ' }, { id: 'd', generalNote: 'fine' }, { id: 'e' }] }
    expect(repairGeneralNotes(state)).toBe(true)
    expect('generalNote' in state.people[0]).toBe(false)
    expect(state.people[1].generalNote).toHaveLength(GENERAL_NOTE_MAX)
    expect('generalNote' in state.people[2]).toBe(false)
    expect(state.people[3].generalNote).toBe('fine')
    expect(repairGeneralNotes(state)).toBe(false)
  })
  it('an old record without people, or with junk people, is fine', () => {
    for (const s of [{}, { people: null }, { people: [null, 3, 'x'] }]) expect(() => repairGeneralNotes(s)).not.toThrow()
    expect(repairGeneralNotes({})).toBe(false)
  })
})

describe('search inside a person\'s notes', () => {
  it('every word, case and accents ignored; an empty query matches', () => {
    expect(generalNoteMatches('Likes Schach und Käse', 'kase schach')).toBe(true)
    expect(generalNoteMatches('Likes chess', 'chess tea')).toBe(false)
    expect(generalNoteMatches('anything', '  ')).toBe(true)
  })
})

describe('autosave: debounced, flushed on blur, injected timers', () => {
  function harness() {
    const timers = []
    const saved = []
    const a = createAutosaver({
      commit: (t) => saved.push(t),
      setTimer: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h },
      clearTimer: (h) => { h.cleared = true },
    })
    const fire = () => { const live = timers.filter((t) => !t.cleared && !t.done); for (const t of live) { t.done = true; t.fn() } }
    return { a, saved, timers, fire }
  }
  it('typing waits for the pause, and only the last text is saved', () => {
    const { a, saved, timers, fire } = harness()
    a.input('h'); a.input('he'); a.input('hel')
    expect(saved).toEqual([])
    expect(timers.filter((t) => !t.cleared)).toHaveLength(1)
    expect(timers[0].ms).toBe(GENERAL_NOTE_DEBOUNCE_MS)
    fire()
    expect(saved).toEqual(['hel'])
    expect(a.pending()).toBe(false)
  })
  it('flush (blur, card closing) saves at once and cancels the pause; flushing with nothing waiting does nothing', () => {
    const { a, saved, timers, fire } = harness()
    a.flush()
    expect(saved).toEqual([])
    a.input('abc')
    expect(a.pending()).toBe(true)
    a.flush()
    expect(saved).toEqual(['abc'])
    expect(timers.every((t) => t.cleared)).toBe(true)
    fire()
    expect(saved).toEqual(['abc']) // the cancelled timer does not save twice
    a.flush()
    expect(saved).toEqual(['abc'])
  })
  it('an empty text is saved too (the note was cleared)', () => {
    const { a, saved, fire } = harness()
    a.input('x'); a.input('')
    fire()
    expect(saved).toEqual([''])
  })
})

describe('the Advanced disclosure remembers it was open for two minutes (one stamp for the phone)', () => {
  function cell() {
    const box = { v: null, failing: false }
    return {
      box,
      read: () => { if (box.failing) throw new Error('blocked'); return box.v },
      write: (v) => { if (box.failing) throw new Error('blocked'); box.v = v },
      clear: () => { if (box.failing) throw new Error('blocked'); box.v = null },
    }
  }
  it('starts collapsed; open within two minutes of the stamp, collapsed after', () => {
    let now = 1_000_000
    const c = cell()
    const m = createAdvancedMemory(c, () => now)
    expect(m.wasOpen()).toBe(false)
    m.markOpen()
    now += ADVANCED_MEMORY_MS - 1
    expect(m.wasOpen()).toBe(true)
    now += 1
    expect(m.wasOpen()).toBe(false)
  })
  it('using it again refreshes the stamp; closing it forgets at once', () => {
    let now = 5_000_000
    const m = createAdvancedMemory(cell(), () => now)
    m.markOpen()
    now += 100_000
    m.markOpen()
    now += 100_000
    expect(m.wasOpen()).toBe(true)
    m.markClosed()
    expect(m.wasOpen()).toBe(false)
  })
  it('one stamp for the phone: a second reader of the same cell sees it (not per person)', () => {
    const c = cell()
    const now = () => 9_000_000
    createAdvancedMemory(c, now).markOpen()
    expect(createAdvancedMemory(c, now).wasOpen()).toBe(true)
  })
  it('a storage that throws only means collapsed; garbage and a stamp in the future count as none', () => {
    const c = cell()
    c.box.failing = true
    const m = createAdvancedMemory(c, () => 10)
    expect(() => m.markOpen()).not.toThrow()
    expect(() => m.markClosed()).not.toThrow()
    expect(m.wasOpen()).toBe(false)
    c.box.failing = false
    c.box.v = 'junk'
    expect(m.wasOpen()).toBe(false)
    c.box.v = '99999'
    expect(m.wasOpen()).toBe(false)
  })
  it('localStorageCell reads and writes one key and copes with no storage', () => {
    const mem = new Map()
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) }, removeItem: (k) => { mem.delete(k) } }
    const c = localStorageCell('k', () => storage)
    c.write('5'); expect(c.read()).toBe('5'); c.clear(); expect(c.read()).toBeNull()
    const none = localStorageCell('k', () => undefined)
    expect(none.read()).toBeNull()
    expect(() => { none.write('1'); none.clear() }).not.toThrow()
  })
})

describe('transcribing next to the typed note', () => {
  const meeting = (extra) => ({ id: 'm' + Math.random(), about: 'Dana', kind: 'who', personId: 'p1', where: '', startedAt: 1, endedAt: 2, durationMs: 1, meeting: false, lines: [], transcript: [], ...extra })
  it('a meeting whose server transcription runs, or whose full transcript has not arrived, is pending; a finished one is not', () => {
    expect(transcriptPending(meeting({ serverJob: { state: ServerJobState.Running, at: 1, takesDone: 0 } }))).toBe(true)
    expect(transcriptPending(meeting({ late: { id: 'x' } }))).toBe(true)
    expect(transcriptPending(meeting({ serverJob: { state: ServerJobState.Done, at: 1, takesDone: 1 } }))).toBe(false)
    expect(transcriptPending(meeting({}))).toBe(false)
  })
  it('pendingTranscripts counts only that person\'s meetings', () => {
    const s = {
      people: [{ id: 'p1', name: 'Dana', lines: [] }, { id: 'p2', name: 'Eli', lines: [] }],
      meetings: [
        meeting({ id: 'a', serverJob: { state: ServerJobState.Running, at: 1, takesDone: 0 } }),
        meeting({ id: 'b', personId: 'p2', serverJob: { state: ServerJobState.Running, at: 1, takesDone: 0 } }),
        meeting({ id: 'c' }),
      ],
    }
    expect(pendingTranscripts(s, 'p1')).toBe(1)
    expect(pendingTranscripts(s, 'p2')).toBe(1)
    expect(pendingTranscripts(s, 'nobody')).toBe(0)
  })
})

describe('PRIVACY: the General note is Only me', () => {
  const SECRET = 'SECRET-GENERAL-NOTE-ABOUT-DANA'
  const now = Date.UTC(2026, 9, 8)
  const state = {
    v: 1, me: { id: 'cleo', displayName: 'Cleo' }, peers: [], log: [], notificationsOn: false, inventory: [],
    people: [{
      id: 'p1', name: 'Dana', context: 'met', ring: Ring.Friend, metAt: now, generalNote: SECRET,
      lines: [{ id: 'l1', text: 'Dana has a ladder', tag: Tag.Note, audience: Audience.FriendsOfFriends, status: LineStatus.Current, notedAt: now, checkedAt: now }],
    }],
  }
  it('the matcher input of an ask never holds it, at any ring or step', () => {
    for (const ring of [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending]) {
      for (const hop of [0, 1, 2]) expect(JSON.stringify(askSources(state, ring, hop))).not.toContain(SECRET)
    }
    expect(askSources(state, Ring.Friend, 0).threads.length).toBeGreaterThan(0)
  })
  it('askSources does not remove the note from the record it was given', () => {
    askSources(state, Ring.Friend, 0)
    expect(state.people[0].generalNote).toBe(SECRET)
  })
  it('the source names the field only where it is meant to: a new reader that names the field must be added to the allowlist (a generic spread of the record is not caught)', () => {
    const allowed = new Set([
      'general_notes.ts', // the rules
      'person_general_view.ts', // the field on the card (through generalNoteOf / commit; names it only in comments)
      'past_meetings_view.ts', // the entry in "Your notes on them" (generalNoteOf), on this phone
      'model.ts', // the type
      'cascade.ts', // strips it from the ask matcher's copy of the record
      'main.ts', // the hook: setGeneralNote / generalNoteOf
      'strings.ts', // copy
      'rings_layout.ts', // "in contact" for the rings drop: whether a note exists, on this phone (never its text)
      'demo_to_live.ts', // carries a demo person's whole record to the live phone of the same owner, on this device (no network)
    ])
    const hits = []
    for (const f of readdirSync(SRC).filter((x) => x.endsWith('.ts'))) {
      const text = readFileSync(path.join(SRC, f), 'utf8')
      if (/\bgeneralNote\b/.test(text) && !allowed.has(f)) hits.push(f)
    }
    expect(hits).toEqual([])
  })
  it('the share, contact, ask and export builders do not read a person\'s free text: none of these modules names a Person note at all', () => {
    for (const f of ['share.ts', 'contact_share.ts', 'hops.ts', 'direct_ask.ts', 'notes_source.ts', 'search.ts', 'provenance.ts', 'net.ts', 'backup.ts', 'hosting.ts', 'hosted_recording.ts', 'inventory_import.ts', 'demo_inventory_public.ts']) {
      expect(/\bgeneralNote\b/.test(readFileSync(path.join(SRC, f), 'utf8')), f).toBe(false)
    }
  })
})
