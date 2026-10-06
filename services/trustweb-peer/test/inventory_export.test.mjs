/**
 * The personal inventory exporter: the mark logic, the Tana reader (read-only,
 * one hop), the four outputs, and the rule "nothing unmarked leaves this Mac"
 * checked property-style over random inventories. Plus a CLI smoke test of the
 * dry run against a fake tana_mcp.sh.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, chmodSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import {
  IMPORT_FORMAT, LINE_MAX, LineSource, MarkKind, Provenance, TanaReadTool, Verdict, assertServerFileSafe, buildExport, cleanText,
  fullFile, identifyingReason, importFile, lineFrom, parseChoices, parseFolderLine, parseTanaMark, readTanaInventory, renderReview,
  scrubText, serverFile,
} from '../inventory_export.ts'
import { reviewIsFresh, parseArgs, tanaViaScript, isExplicitYes, send, readFolder } from '../../../scripts/trustweb_inventory_export.ts'
import { presetContext } from '../peer.ts'

const OPTS = { today: '2026-10-06', by: 'Jakob', knownIds: new Set() }
const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const tmp = () => mkdtempSync(path.join(tmpdir(), 'twexport-'))

/** A fake Tana: get_children over a fixed tree, recording every call. */
function fakeTana(tree, pageSize = 1000) {
  const calls = []
  const call = async (tool, args) => {
    calls.push({ tool, args })
    if (tool !== TanaReadTool.GetChildren) throw new Error('unexpected tool ' + tool)
    const all = tree[args.nodeId] ?? []
    const page = all.slice(args.offset, args.offset + Math.min(args.limit, pageSize))
    return { children: page.map((c) => ({ childCount: (tree[c.id] ?? []).length, inTrash: false, ...c })), total: all.length, hasMore: args.offset + page.length < all.length }
  }
  return { call, calls }
}

const TREE = {
  ROOT00000001: [
    { id: 'DESC00000001', name: 'What this is: the index ...' },
    { id: 'INBOX0000001', name: 'inbox' },
    { id: 'REFD00000001', name: 'referenced' },
  ],
  REFD00000001: [
    { id: 'GTOOLS000001', name: 'tools' },
    { id: 'GOFFERS00001', name: 'offers' },
    { id: 'ITTS00000001', name: 'Text to speech: Kokoro by default' },
  ],
  GTOOLS000001: [
    { id: 'ITOOL0000001', name: 'FreeFlow', description: 'dictation on the Mac' },
    { id: 'ITOOL0000002', name: 'JARVIS' },
    { id: 'ITRASH000001', name: 'gone', inTrash: true },
  ],
  ITOOL0000002: [
    { id: 'C00000000001', name: '' },
    { id: 'C00000000002', name: 'voice assistant <span data-inlineref-node="XyZ123abcDEF"></span>for the desk' },
    { id: 'C00000000003', name: 'Allowed in advance: for people I met' },
  ],
  GOFFERS00001: [
    { id: 'IOFFER000001', name: 'Projector for a talk, Vienna' },
    { id: 'IOFFER000002', name: 'Notes in IOFFER000001 style' },
  ],
  IOFFER000001: [{ id: 'C00000000004', name: 'allowed in advance' }],
  IOFFER000002: [{ id: 'C00000000005', name: 'allowed in advance' }],
  INBOX0000001: [{ id: 'IINBOX000001', name: 'Guest bed, two nights' }],
}

describe('text hygiene', () => {
  it('strips inline markup (and the node ids inside it), collapses whitespace', () => {
    expect(cleanText('a <span data-inlineref-node="XyZ123abcDEF"></span> b&nbsp;&amp;  c')).toBe('a b & c')
  })
  it('builds "title: first line", capped at what the peer keeps', () => {
    expect(lineFrom('FreeFlow', 'dictation')).toBe('FreeFlow: dictation')
    expect(lineFrom('FreeFlow', 'freeflow')).toBe('FreeFlow')
    expect(lineFrom('FreeFlow')).toBe('FreeFlow')
    const long = lineFrom('T', 'x'.repeat(400))
    expect(long.length).toBe(LINE_MAX)
    expect(long.endsWith('…')).toBe(true)
  })
  it('flags node ids, Tana links, DIDs and fine timestamps; a plain line or a day is fine', () => {
    const ids = new Set(['ABCdef123456'])
    expect(identifyingReason('see ABCdef123456', ids)).toMatch(/Tana node id/)
    expect(identifyingReason('tana:ABCdef123456', new Set())).toMatch(/identifier/)
    expect(identifyingReason('https://app.tana.inc?nodeid=x', new Set())).toMatch(/identifier/)
    expect(identifyingReason('did:peer:2.Ez6abc', new Set())).toMatch(/identifier/)
    expect(identifyingReason('met 2026-10-06T10:15', new Set())).toMatch(/timestamp/)
    expect(identifyingReason('epoch 1791234567890', new Set())).toMatch(/timestamp/)
    expect(identifyingReason('Guest bed from 2026-10-06, two nights', new Set())).toBeNull()
    // the Vienna way of writing a date-time
    expect(identifyingReason('met Anna 6.10.2026 14:30 at the Hub', new Set())).toMatch(/timestamp/)
    expect(identifyingReason('met Anna 6. 10. 26, um 9.30', new Set())).toMatch(/timestamp/)
    expect(identifyingReason('sale 6.10.2026', new Set())).toBeNull()
  })
  it('scrubText replaces each identifier as a WHOLE token (nothing of a DID, link or node id survives)', () => {
    const ids = new Set(['ABCdef123456'])
    expect(scrubText('see ABCdef123456 and did:peer:2.Ez6LSabc.Vz6Mkdef here', ids)).toBe('see [link] and [link] here')
    expect(scrubText('open https://app.tana.inc/?nodeid=QQQQwwww1234 now', new Set())).toBe('open [link] now')
    expect(scrubText('ref nodeid=QQQQwwww1234, ok', new Set())).toBe('ref [link], ok')
    expect(scrubText('[[Anna^QQQQwwww1234]] and tana:QQQQwwww1234', new Set())).toBe('[link] and [link]')
    expect(scrubText('call 2026-10-06T10:15:30Z or 6.10.2026 14:30 or 1791234567890', new Set())).toBe('call [link] or [link] or [link]')
    for (const t of ['did:peer:2.Ez6LSabc', 'https://app.tana.inc/?nodeid=QQQQwwww1234', 'nodeid=QQQQwwww1234']) {
      expect(scrubText(t, new Set())).not.toMatch(/Ez6|QQQQ/)
    }
  })
})

describe('marks', () => {
  it('Tana child "allowed in advance[: note]", any case; anything else is no mark', () => {
    expect(parseTanaMark('allowed in advance')).toEqual({ kind: MarkKind.TanaChild })
    expect(parseTanaMark('Allowed in advance: for neighbours')).toEqual({ kind: MarkKind.TanaChild, note: 'for neighbours' })
    expect(parseTanaMark('ALLOWED IN ADVANCE')).toEqual({ kind: MarkKind.TanaChild })
    expect(parseTanaMark('Allowed in advance :  for friends ')).toEqual({ kind: MarkKind.TanaChild, note: 'for friends' })
    expect(parseTanaMark('allowed in advance: <span data-inlineref-node="XyZ123abcDEF">Anna</span>')).toEqual({ kind: MarkKind.TanaChild, note: 'Anna' })
    // only the exact grammar marks: anything looser is a thought, not a permission
    for (const near of ['ALLOWED IN ADVANCE  for friends', 'allowed in advance? ask first', 'allowed in advance (not yet)',
      'allowed in advance - no', 'allowed in advance for nobody', '"allowed in advance"', '> allowed in advance', 'not allowed in advance']) {
      expect(parseTanaMark(near), near).toBeNull()
    }
    expect(parseTanaMark('allowed in advanced')).toBeNull()
    expect(parseTanaMark('allowed')).toBeNull()
    expect(parseTanaMark('allowed in advance: ' + 'n'.repeat(300)).note.length).toBe(120)
  })
  it('Mac folder: "+ " marks, bullets and plain lines do not, comments and blanks are skipped', () => {
    expect(parseFolderLine('+ Spare desk, Fridays', 'a.txt')).toEqual({ text: 'Spare desk, Fridays', source: LineSource.MacFolder, category: 'a.txt', mark: { kind: MarkKind.MacPlus } })
    expect(parseFolderLine('- Private thing', 'a.txt').mark).toBeUndefined()
    expect(parseFolderLine('* Private thing', 'a.txt').text).toBe('Private thing')
    expect(parseFolderLine('Plain line', 'a.txt').mark).toBeUndefined()
    expect(parseFolderLine('+Spare desk', 'a.txt').mark).toBeUndefined()
    expect(parseFolderLine('# heading', 'a.txt')).toBeNull()
    expect(parseFolderLine('   ', 'a.txt')).toBeNull()
  })
  it('choices file: ticked lines kept, allowInAdvance marks, unticked and malformed rows skipped', () => {
    const c = parseChoices({ generated: 'x', items: [
      { candidate: 'Note A', tanaNodeId: 'AAAAAAAAAAA1', line: 'Line one', toTana: true, allowInAdvance: true },
      { candidate: 'Note A', tanaNodeId: 'AAAAAAAAAAA1', line: ' Line two ', toTana: true, allowInAdvance: false },
      { candidate: 'Note B', line: 'Not ticked', toTana: false, allowInAdvance: true },
      { candidate: 'Note B', line: '', toTana: true, allowInAdvance: true },
      { candidate: 'Note B', line: 'Allow as a string', toTana: true, allowInAdvance: 'true' },
      'junk', null,
    ] })
    expect(c.map((x) => [x.text, Boolean(x.mark)])).toEqual([['Line one', true], ['Line two', false], ['Allow as a string', false]])
    expect(c[0]).toMatchObject({ source: LineSource.KimiReview, category: 'Note A', tanaNodeId: 'AAAAAAAAAAA1', mark: { kind: MarkKind.KimiChoice } })
    expect(() => parseChoices({})).toThrow(/no items/)
  })
})

describe('readTanaInventory (read-only, one hop)', () => {
  it('reads groups, items, the inbox and marks; skips trash; only ever calls get_children; pages through', async () => {
    const { call, calls } = fakeTana(TREE, 1)
    const r = await readTanaInventory(call, 'ROOT00000001')
    expect(calls.every((c) => c.tool === TanaReadTool.GetChildren)).toBe(true)
    const byText = Object.fromEntries(r.candidates.map((c) => [c.text, c]))
    expect(Object.keys(byText).sort()).toEqual([
      'FreeFlow: dictation on the Mac',
      'Guest bed, two nights',
      'JARVIS: voice assistant for the desk',
      'Notes in IOFFER000001 style',
      'Projector for a talk, Vienna',
      'Text to speech: Kokoro by default',
    ])
    expect(byText['JARVIS: voice assistant for the desk']).toMatchObject({ category: 'tools', tanaNodeId: 'ITOOL0000002', mark: { kind: MarkKind.TanaChild, note: 'for people I met' } })
    expect(byText['Projector for a talk, Vienna'].mark).toEqual({ kind: MarkKind.TanaChild })
    expect(byText['FreeFlow: dictation on the Mac'].mark).toBeUndefined()
    expect(byText['Guest bed, two nights']).toMatchObject({ source: LineSource.TanaInbox, category: 'inbox' })
    expect(byText['Text to speech: Kokoro by default'].category).toBe('referenced')
    expect(r.readIds).toEqual(expect.arrayContaining(['ROOT00000001', 'REFD00000001', 'GTOOLS000001', 'ITOOL0000002', 'INBOX0000001']))
    expect(r.readIds).not.toContain('ITRASH000001')
    expect(r.seenIds.has('C00000000003')).toBe(true)
  })
})

describe('buildExport and the four outputs', () => {
  async function exported() {
    const { call } = fakeTana(TREE)
    const tana = await readTanaInventory(call, 'ROOT00000001')
    const choices = parseChoices({ items: [
      { candidate: 'Walk', tanaNodeId: 'KIMI00000001', line: 'Introductions to people in regenerative farming', toTana: true, allowInAdvance: true },
      { candidate: 'Walk', tanaNodeId: 'KIMI00000001', line: 'Guest bed, two nights', toTana: true, allowInAdvance: false },
    ] })
    const folder = [parseFolderLine('+ projector for a talk,   Vienna', 'mac.txt'), parseFolderLine('- my private diary', 'mac.txt')]
    const knownIds = new Set([...tana.seenIds, 'KIMI00000001'])
    const opts = { ...OPTS, knownIds }
    return { lines: buildExport([...tana.candidates, ...choices, ...folder], opts), opts, readIds: tana.readIds }
  }

  it('merges duplicates across sources, keeps the first explicit mark, decides each line', async () => {
    const { lines } = await exported()
    const v = Object.fromEntries(lines.map((l) => [l.text, l]))
    expect(v['Projector for a talk, Vienna'].sources).toEqual([LineSource.TanaReferenced, LineSource.MacFolder])
    expect(v['Projector for a talk, Vienna'].verdict).toBe(Verdict.Leaves)
    expect(v['JARVIS: voice assistant for the desk'].verdict).toBe(Verdict.Leaves)
    expect(v['Introductions to people in regenerative farming'].verdict).toBe(Verdict.Leaves)
    expect(v['Guest bed, two nights'].verdict).toBe(Verdict.StaysUnmarked)
    expect(v['Guest bed, two nights'].sources).toEqual([LineSource.TanaInbox, LineSource.KimiReview])
    expect(v['my private diary'].verdict).toBe(Verdict.StaysUnmarked)
    expect(v['FreeFlow: dictation on the Mac'].verdict).toBe(Verdict.StaysUnmarked)
    // marked, but its text names a Tana node id: stays, and the review says why
    expect(v['Notes in IOFFER000001 style'].verdict).toBe(Verdict.StaysIdentifying)
    expect(v['Notes in IOFFER000001 style'].reason).toMatch(/marked by you, but it contains a Tana node id/)
  })

  it('server file: the leaving lines only, day-only presets, no ids, passes the send check', async () => {
    const { lines, opts } = await exported()
    const s = serverFile(lines, opts)
    expect(s.items.map((i) => i.text).sort()).toEqual(['Introductions to people in regenerative farming', 'JARVIS: voice assistant for the desk', 'Projector for a talk, Vienna'])
    expect(s.items.every((i) => i.audience === 'fof' && i.preset.by === 'Jakob' && i.preset.at === '2026-10-06')).toBe(true)
    expect(s.items.find((i) => i.text.startsWith('JARVIS')).preset.note).toBe('for people I met')
    expect(Object.keys(s)).toEqual(['items'])
    const raw = JSON.stringify(s)
    for (const id of opts.knownIds) expect(raw).not.toContain(id)
    expect(assertServerFileSafe(s, lines, opts.knownIds)).toBe(3)
  })

  it('the send check refuses a tampered server file', async () => {
    const { lines, opts } = await exported()
    const s = serverFile(lines, opts)
    expect(() => assertServerFileSafe({ items: [...s.items, { text: 'Guest bed, two nights', audience: 'fof', preset: { by: 'Jakob', at: '2026-10-06' } }] }, lines, opts.knownIds)).toThrow(/not marked/)
    expect(() => assertServerFileSafe({ items: [{ ...s.items[0], preset: { by: 'Jakob', at: '2026-10-06T10:00:00Z' } }] }, lines, opts.knownIds)).toThrow(/day-only/)
    expect(() => assertServerFileSafe({ ...s, owner: 'did:peer:2.x' }, lines, opts.knownIds)).toThrow(/DID/)
    expect(() => assertServerFileSafe({ ...s, at: 1 }, lines, opts.knownIds)).toThrow(/unexpected fields/)
    expect(() => assertServerFileSafe({ items: [{ ...s.items[0], text: 'x ITOOL0000001' }] }, lines, opts.knownIds)).toThrow(/Tana node id/)
    expect(() => assertServerFileSafe({ items: [{ ...s.items[0], tanaNodeIds: [] }] }, lines, opts.knownIds)).toThrow(/unexpected fields/)
    expect(() => assertServerFileSafe({ items: [{ ...s.items[0], preset: { ...s.items[0].preset, source: 'x' } }] }, lines, opts.knownIds)).toThrow(/unexpected fields/)
    expect(() => assertServerFileSafe({ items: [{ ...s.items[0], preset: { ...s.items[0].preset, note: 'met 2026-10-06T10:00' } }] }, lines, opts.knownIds)).toThrow(/identifying/)
  })

  it('import file for his own phone: every line, "Only me", no ids, stable keys', async () => {
    const { lines, opts } = await exported()
    const f = importFile(lines, opts)
    expect(f).toMatchObject({ format: IMPORT_FORMAT, version: 1, exportedOn: '2026-10-06' })
    expect(f.items).toHaveLength(lines.length)
    expect(f.items.every((i) => i.audience === 'me' && /^[0-9a-f]{16}$/.test(i.key))).toBe(true)
    expect(f.items.find((i) => i.text === 'my private diary').provenance).toBe(Provenance.Mac)
    expect(f.items.find((i) => i.text === 'Projector for a talk, Vienna')).toMatchObject({ provenance: Provenance.Tana, allowedInAdvance: true })
    expect(f.items.find((i) => i.text.startsWith('Notes in'))).toMatchObject({ text: 'Notes in [link] style', allowedInAdvance: true })
    const raw = JSON.stringify(f)
    for (const id of opts.knownIds) expect(raw).not.toContain(id)
    expect(raw).not.toMatch(/did:|tanaNodeId/)
    const again = importFile(buildExport(lines.map((l) => ({ text: l.text.toUpperCase(), source: l.sources[0], category: l.category })), opts), opts)
    expect(again.items.map((i) => i.key)).toEqual(f.items.map((i) => i.key))
  })

  it('full file (Mac only) and review file say what leaves, what stays and why', async () => {
    const { lines, opts, readIds } = await exported()
    const full = fullFile(lines, opts, readIds)
    expect(full.items).toHaveLength(lines.length)
    expect(full.tanaNodesRead).toEqual(readIds)
    expect(full.items.filter((i) => i.preset).length).toBe(3)
    const review = renderReview(lines, { runId: 'abc123', by: 'Jakob', today: '2026-10-06', generatedAt: 'now', mode: 'dry run', destination: 'nowhere', inputs: ['x'], files: ['f'] })
    expect(review).toContain('run abc123, dry run')
    expect(review).toContain('WOULD LEAVE THIS MAC: 3 line(s)')
    expect(review).toContain('STAYS ON THIS MAC')
    expect(review).toMatch(/\+ Projector for a talk, Vienna\n {6}why: a Tana child "allowed in advance" under it/)
    expect(review).toMatch(/- my private diary\n {6}why: not marked/)
    // the note leaves the Mac too, so the review shows it exactly as the asker will see it
    expect(review).toContain('the asker sees: "JARVIS: voice assistant for the desk" marked "Allowed in advance by Jakob (2026-10-06): for people I met"')
    expect(presetContext({ by: 'Jakob', at: '2026-10-06', note: 'for people I met' })).toBe('Allowed in advance by Jakob (2026-10-06): for people I met')
  })

  it('send: shows every line with its wire context, sends only after a typed y (ENTER and n send nothing), pipes exactly the server file', async () => {
    const { lines, opts } = await exported()
    const s = serverFile(lines, opts)
    expect(['', ' ', '\n', 'n', 'no', 'yy', 'ja'].map(isExplicitYes)).toEqual([false, false, false, false, false, false, false])
    expect(['y', 'Y', ' yes '].map(isExplicitYes)).toEqual([true, true, true])
    for (const answer of ['', 'n']) {
      const printed = []
      const calls = []
      const sent = await send('sebra', s, { ask: async () => answer, ssh: async (...a) => { calls.push(a); return '' }, print: (l) => printed.push(l) })
      expect(sent).toBe(false)
      expect(calls).toHaveLength(0)
      expect(printed.join('\n')).toContain('marked "Allowed in advance by Jakob (2026-10-06): for people I met"')
    }
    const calls = []
    const sent = await send('sebra', s, {
      ask: async () => 'y',
      ssh: async (host, cmd, stdin) => { calls.push({ host, cmd, stdin }); return /\/status/.test(cmd) && !stdin ? JSON.stringify({ presetLines: s.items.length }) : '' },
      print: () => {},
    })
    expect(sent).toBe(true)
    expect(calls.every((c) => c.host === 'sebra')).toBe(true)
    expect(calls.filter((c) => c.stdin).map((c) => c.stdin)).toEqual([JSON.stringify(s) + '\n'])
  })
})

describe('the Mac folder', () => {
  it('reads only regular files in the folder itself: a symlink to a file elsewhere is skipped and named', () => {
    const dir = tmp()
    const folder = path.join(dir, 'folder')
    mkdirSync(folder)
    writeFileSync(path.join(dir, 'elsewhere.txt'), '+ secret from outside the folder\n')
    writeFileSync(path.join(folder, 'mine.txt'), '+ Spare desk, Fridays\n')
    symlinkSync(path.join(dir, 'elsewhere.txt'), path.join(folder, 'link.txt'))
    mkdirSync(path.join(folder, 'sub.md'))
    const warned = []
    const c = readFolder(folder, (m) => warned.push(m))
    expect(c.map((x) => x.text)).toEqual(['Spare desk, Fridays'])
    expect(warned.join('\n')).toMatch(/skipped link\.txt/)
    expect(warned.join('\n')).toMatch(/skipped sub\.md/)
    rmSync(dir, { recursive: true })
  })
})

describe('property: nothing unmarked leaves this Mac', () => {
  /** mulberry32: a seeded PRNG so a failure reproduces. */
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const WORDS = ['bike', 'tent', 'desk', 'Vienna', 'intro', 'projector', 'garden', 'room', 'tools', 'farm', 'Kokoro', 'note']
  const SPICE = ['', '', '', ' did:peer:2.Ez6x', ' 2026-10-06T09:30', ' tana:QQQQQQQQQQQQ', ' 1791234567890', ' <span data-inlineref-node="ZZZZZZZZZZZZ"></span>']

  it('over 400 random inventories the server file is always a subset of the marked, clean lines', () => {
    const r = rng(1733)
    const pick = (a) => a[Math.floor(r() * a.length)]
    for (let run = 0; run < 400; run++) {
      const ids = new Set()
      const candidates = []
      const n = Math.floor(r() * 25)
      for (let i = 0; i < n; i++) {
        const id = 'N' + String(run).padStart(4, '0') + String(i).padStart(7, '0')
        ids.add(id)
        let text = Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(WORDS)).join(' ') + pick(SPICE)
        if (r() < 0.05) text += ' ' + id
        const source = pick(Object.values(LineSource))
        const marked = r() < 0.4
        candidates.push({ text, source, category: 'c', ...(source.startsWith('tana') || source === LineSource.KimiReview ? { tanaNodeId: id } : {}), ...(marked ? { mark: { kind: pick(Object.values(MarkKind)) } } : {}) })
      }
      const opts = { ...OPTS, knownIds: ids }
      const lines = buildExport(candidates, opts)
      const s = serverFile(lines, opts)
      const markedTexts = new Set(candidates.filter((c) => c.mark).map((c) => cleanText(c.text).toLowerCase()))
      for (const it of s.items) {
        expect(markedTexts.has(it.text.toLowerCase())).toBe(true)
        expect(identifyingReason(it.text, ids)).toBeNull()
        expect(it.preset.at).toBe('2026-10-06')
      }
      const raw = JSON.stringify(s)
      for (const id of ids) expect(raw).not.toContain(id)
      expect(raw).not.toMatch(/did:|T\d{2}:\d{2}|tana:/)
      expect(assertServerFileSafe(s, lines, ids)).toBe(s.items.length)
      // nothing marked and clean is lost either
      expect(s.items.length).toBe(lines.filter((l) => l.mark && !identifyingReason(l.text, new Set([...ids, ...l.tanaNodeIds]))).length)
      expect(importFile(lines, opts).items).toHaveLength(lines.length)
    }
  })
})

describe('property, end to end through the real readers (Tana tree, choices file, Mac folder)', () => {
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const WORDS = ['bike', 'tent', 'desk', 'Vienna', 'intro', 'projector', 'garden', 'room', 'farm', 'kettle', 'ladder', 'sauna']
  // children that look like a mark but are not one (the generator records them as NOT marking)
  const NEAR = ['allowed in advance? ask first', 'allowed in advance (not yet)', 'not allowed in advance', 'allowed in advanced',
    'Allowed in advance for nobody', '"allowed in advance"', 'allowed in advance - no', 'note: allowed in advance']
  const REAL = ['allowed in advance', 'Allowed in advance', 'ALLOWED IN ADVANCE: for neighbours', 'allowed in advance:   ok']

  it('over 300 random inventories, the server file holds exactly the lines the GENERATOR marked (and nothing identifying)', async () => {
    const r = rng(20261006)
    const pick = (a) => a[Math.floor(r() * a.length)]
    const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ')
    for (let run = 0; run < 300; run++) {
      let seq = 0
      const id = () => 'P' + String(run).padStart(4, '0') + String(seq++).padStart(7, '0')
      const tree = {}
      const intended = new Set() // normalised texts the generator meant to allow
      const all = new Set()
      const root = id(), refd = id(), inbox = id()
      tree[root] = [{ id: refd, name: 'referenced' }, { id: inbox, name: 'inbox' }]
      tree[refd] = []
      tree[inbox] = []
      const n = 1 + Math.floor(r() * 10)
      for (let i = 0; i < n; i++) {
        const itemId = id()
        const title = words(1 + Math.floor(r() * 3)) + ' ' + i + 'x' + run // unique titles: no cross-merge by accident
        const kids = []
        const marked = r() < 0.35
        if (r() < 0.5) kids.push({ id: id(), name: words(2) })              // first line
        if (r() < 0.4) kids.push({ id: id(), name: pick(NEAR) })            // a near miss never marks
        if (marked) kids.push({ id: id(), name: pick(REAL) })
        // a grandchild mark never marks the item
        if (r() < 0.3) { const g = id(); kids.push({ id: g, name: 'details' }); tree[g] = [{ id: id(), name: 'allowed in advance' }] }
        tree[itemId] = kids
        ;(r() < 0.5 ? tree[refd] : tree[inbox]).push({ id: itemId, name: title })
      }
      const { call } = fakeTana(tree, 1 + Math.floor(r() * 4))
      const tana = await readTanaInventory(call, root)
      for (const c of tana.candidates) all.add(c.text.toLowerCase())
      // which Tana lines the generator meant: those whose node got a REAL mark child
      for (const c of tana.candidates) if ((tree[c.tanaNodeId] ?? []).some((k) => REAL.includes(k.name))) intended.add(c.text.toLowerCase())
      // choices rows: only toTana === true && allowInAdvance === true is meant
      const rows = Array.from({ length: Math.floor(r() * 5) }, (_, k) => {
        const toTana = pick([true, false, 'true', 1, undefined])
        const allow = pick([true, false, 'true', 1, undefined])
        return { candidate: 'c', line: 'kimi ' + words(2) + ' ' + k + 'k' + run, toTana, allowInAdvance: allow }
      })
      for (const row of rows) {
        if (row.toTana === true) all.add(row.line.toLowerCase())
        if (row.toTana === true && row.allowInAdvance === true) intended.add(row.line.toLowerCase())
      }
      // folder lines: only "+ " is meant
      const folder = Array.from({ length: Math.floor(r() * 5) }, (_, k) => {
        const lead = pick(['+ ', '- ', '* ', '', '+', '# ', '++ '])
        return { raw: lead + 'mac ' + words(2) + ' ' + k + 'm' + run, lead }
      })
      const folderCands = folder.map((f) => parseFolderLine(f.raw, 'f.txt')).filter(Boolean)
      // only "+ " (plus, then a space) marks; "+x" and "++ x" do not
      for (const f of folder) if (f.lead === '+ ') intended.add(f.raw.slice(2).trim().toLowerCase())
      const candidates = [...tana.candidates, ...parseChoices({ items: rows }), ...folderCands]
      const knownIds = tana.seenIds
      const opts = { ...OPTS, knownIds }
      const lines = buildExport(candidates, opts)
      const s = serverFile(lines, opts)
      const left = s.items.map((i) => i.text.toLowerCase())
      for (const t of left) expect(intended.has(t), `unintended line left: ${t}`).toBe(true)
      for (const t of intended) expect(left.includes(t), `intended line missing: ${t}`).toBe(true)
      const raw = JSON.stringify(s)
      for (const x of knownIds) expect(raw).not.toContain(x)
      expect(assertServerFileSafe(s, lines, knownIds)).toBe(s.items.length)
    }
  })
})

describe('the CLI', () => {
  function fakeScript(dir, tree) {
    const log = path.join(dir, 'tana-calls.log')
    const js = path.join(dir, 'fake_tana.mjs')
    writeFileSync(path.join(dir, 'tree.json'), JSON.stringify(tree))
    writeFileSync(js, `import { readFileSync, appendFileSync } from 'node:fs'
const [tool, json] = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n')
if (tool !== 'get_children') { console.error('write refused'); process.exit(4) }
const a = JSON.parse(json); const tree = JSON.parse(readFileSync(${JSON.stringify(path.join(dir, 'tree.json'))}, 'utf8'))
const all = tree[a.nodeId] ?? []
const page = all.slice(a.offset, a.offset + a.limit).map((c) => ({ childCount: (tree[c.id] ?? []).length, ...c }))
console.log(JSON.stringify({ children: page, total: all.length, hasMore: a.offset + page.length < all.length }))
`)
    const sh = path.join(dir, 'tana_mcp.sh')
    writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`)
    chmodSync(sh, 0o755)
    return { sh, log }
  }
  function run(args, env) {
    return new Promise((resolve) => {
      execFile(path.join(REPO, 'node_modules/.bin/tsx'), [path.join(REPO, 'scripts/trustweb_inventory_export.ts'), ...args], { env: { ...process.env, ...env }, cwd: REPO }, (err, stdout, stderr) => {
        resolve({ code: err ? err.code : 0, stdout, stderr })
      })
    })
  }

  it('argument guard: --send needs --host; unknown hosts and options are refused', () => {
    expect(parseArgs(['--no-tana']).send).toBe(false)
    expect(parseArgs(['--send', '--host', 'sebra']).host).toBe('sebra')
  })

  it('tanaViaScript refuses any tool that is not a read tool, before running anything', async () => {
    await expect(tanaViaScript('/nonexistent')('import_tana_paste', {})).rejects.toThrow(/not a read tool/)
  })

  it('dry run: reads Tana through the script (get_children only), writes (a), (c), (d) private, no server file, sends nothing', async () => {
    const dir = tmp()
    const { sh, log } = fakeScript(dir, { ...TREE, qAo6KedrMFrC: TREE.ROOT00000001 })
    const mac = path.join(dir, 'mac')
    mkdirSync(mac)
    writeFileSync(path.join(mac, 'private.md'), '# mine\n+ Spare desk, Fridays\n- my diary\n')
    const out = path.join(dir, 'out')
    const review = path.join(dir, 'review.txt')
    const r = await run(['--out', out, '--review', review, '--mac-folder', mac], { TW_TANA_MCP: sh })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('dry run: nothing left this Mac')
    expect(r.stdout).toMatch(/would leave this Mac: 3; stay: 5/)
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    expect(calls.length).toBeGreaterThan(5)
    expect(calls.every((c) => c.startsWith('get_children '))).toBe(true)
    expect(calls.join('\n')).not.toContain('--write')
    for (const f of [path.join(out, 'personal-inventory_full.json'), path.join(out, 'trustweb-inventory-import.json'), review]) {
      expect((statSync(f).mode & 0o777).toString(8)).toBe('600')
    }
    expect((statSync(out).mode & 0o777).toString(8)).toBe('700')
    expect(existsSync(path.join(out, 'personal-inventory_server.json'))).toBe(false)
    const text = readFileSync(review, 'utf8')
    expect(text).toMatch(/WOULD LEAVE THIS MAC: 3 line\(s\)/)
    expect(text).toContain('+ Spare desk, Fridays')
    rmSync(dir, { recursive: true })
  }, 60_000)

  it('--send without a terminal is refused after the review is written, and nothing is sent or staged', async () => {
    const dir = tmp()
    const out = path.join(dir, 'out')
    const mac = path.join(dir, 'mac')
    mkdirSync(mac)
    writeFileSync(path.join(mac, 'a.txt'), '+ Spare desk, Fridays\n')
    const r = await run(['--no-tana', '--mac-folder', mac, '--out', out, '--send', '--host', 'sebra'], {})
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/refused: --send needs a terminal/)
    expect(existsSync(path.join(out, 'export-review.txt'))).toBe(true)
    expect(existsSync(path.join(out, 'personal-inventory_server.json'))).toBe(false)
    const r2 = await run(['--no-tana', '--send'], {})
    expect(r2.code).toBe(2)
    expect(r2.stderr).toMatch(/--send needs --host/)
    rmSync(dir, { recursive: true })
  }, 60_000)

  it('reviewIsFresh: missing, empty, stale or another run\'s file is not fresh', () => {
    const dir = tmp()
    const f = path.join(dir, 'r.txt')
    expect(reviewIsFresh(f, 'run1', Date.now())).toBe(false)
    writeFileSync(f, '')
    expect(reviewIsFresh(f, 'run1', Date.now() - 5000)).toBe(false)
    writeFileSync(f, 'header\nrun other1, dry run\n')
    expect(reviewIsFresh(f, 'run1', Date.now() - 5000)).toBe(false)
    writeFileSync(f, 'header\nrun run1, send\n')
    expect(reviewIsFresh(f, 'run1', Date.now() - 5000)).toBe(true)
    expect(reviewIsFresh(f, 'run1', Date.now() + 60_000)).toBe(false)
    rmSync(dir, { recursive: true })
  })
})
