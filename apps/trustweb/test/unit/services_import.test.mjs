// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { EMAIL_FIELD } from '../../src/intending_reminder.ts'
import { Ring } from '../../src/model.ts'
import { planServices, commitPlan, pendingProposals, decide, bulkAccept, undoBatch, countsLine } from '../../src/services_import.ts'

const NOW = Date.UTC(2026, 9, 31)
const wa = (days) => days.flatMap((d, i) => {
  const dd = String(d).padStart(2, '0')
  return [`[${dd}.10.26, 09:0${i % 9}:00] Mira Test: hello ${i}`, `[${dd}.10.26, 10:0${i % 9}:00] Me Owner: hi back ${i}`]
}).join('\n')
const CHAT = { name: '_chat.txt', text: wa([20, 21, 22, 23, 24, 25]) }
const LI = { name: 'Connections.csv', text: 'Notes:\nignore me\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nOtto,Beispiel,,otto@example.org,Acme,Dev,05 Oct 2024\n' }
const fresh = () => ({ people: [], serviceImports: [] })
const opts = (extra = {}) => ({ me: 'Me Owner', now: NOW, ...extra })
let n = 0
const newId = () => `id${++n}`

describe('planServices: summary before any write (T3)', () => {
  it('detects by content, counts per source, proposals, and writes nothing', () => {
    const s = fresh()
    const plan = planServices(s, [CHAT, LI, { name: 'x.txt', text: 'nothing' }], opts())
    expect(plan.files.map((f) => f.source)).toEqual(['whatsapp', 'linkedin', null])
    expect(plan.counts).toEqual({ whatsapp: 1, linkedin: 1 })
    expect(plan.rows).toHaveLength(2)
    expect(plan.diff).toEqual({ added: 2, changed: 0, unchanged: 0 })
    expect(countsLine(plan.counts)).toMatch(/WhatsApp 1/)
    expect(s.people).toEqual([])
    expect(s.serviceImports).toEqual([])
  })
  it('flags a name that is already a person and a same-name pair as possible duplicates', () => {
    const s = { people: [{ id: 'p', name: 'Otto Beispiel', ring: Ring.Friend, lines: [] }], serviceImports: [] }
    const plan = planServices(s, [LI], opts())
    expect(plan.rows[0].dupe).toBe(true)
  })
  it('stores no message text in rows', () => {
    const plan = planServices(fresh(), [CHAT], opts())
    expect(JSON.stringify(plan.rows)).not.toMatch(/hello|hi back/)
  })
  it('marks an export with no day above 12 as ambiguous', () => {
    const amb = { name: '_chat.txt', text: '[01.02.26, 09:00:00] Mira Test: a\n[02.02.26, 09:00:00] Me Owner: b' }
    expect(planServices(fresh(), [amb], opts()).ambiguous).toBe(true)
    expect(planServices(fresh(), [CHAT], opts()).ambiguous).toBe(false)
  })
})

describe('commit, curate, undo', () => {
  it('commit stores the batch; proposals list the pending rows with label, terms, evidence', () => {
    const s = fresh()
    commitPlan(s, planServices(s, [CHAT, LI], opts()), 'b1', NOW)
    const props = pendingProposals(s, NOW)
    expect(props).toHaveLength(2)
    const mira = props.find((p) => p.row.name === 'Mira Test')
    expect(mira.proposal.label).toBe('inferred, not verified')
    expect(mira.proposal.n365).toBe(12)
    expect([Ring.Close, Ring.Closest]).not.toContain(mira.proposal.ring)
  })
  it('Accept writes the person on the proposed ring with provenance; Leave writes nothing; Change uses the chosen ring', () => {
    const s = fresh()
    commitPlan(s, planServices(s, [CHAT, LI], opts()), 'b1', NOW)
    const [a, b] = pendingProposals(s, NOW)
    decide(s, 'b1', a.row.key, { do: 'accept' }, NOW, newId)
    expect(s.people).toHaveLength(1)
    expect(s.people[0].ring).toBe(a.proposal.ring)
    expect(s.people[0].sources[0]).toMatchObject({ source: a.row.source, file: a.row.file, importedAt: NOW, key: a.row.key })
    decide(s, 'b1', b.row.key, { do: 'leave' }, NOW, newId)
    expect(s.people).toHaveLength(1)
    expect(pendingProposals(s, NOW)).toEqual([])
  })
  it('Change puts the person on the chosen ring', () => {
    const s = fresh()
    commitPlan(s, planServices(s, [LI], opts()), 'b1', NOW)
    const [a] = pendingProposals(s, NOW)
    decide(s, 'b1', a.row.key, { do: 'change', ring: Ring.Friend }, NOW, newId)
    expect(s.people[0].ring).toBe(Ring.Friend)
  })
  it('bulk accept takes only rows without flags', () => {
    const s = { people: [{ id: 'p', name: 'Otto Beispiel', ring: Ring.Friend, lines: [] }], serviceImports: [] }
    commitPlan(s, planServices(s, [CHAT, LI], opts()), 'b1', NOW)
    const done = bulkAccept(s, NOW, newId)
    const mira = pendingProposals(s, NOW)
    expect(done).toBe(1) // Mira (two-way, no flags); Otto is a possible duplicate
    expect(mira.map((m) => m.row.name)).toEqual(['Otto Beispiel'])
  })
  it('undo removes the batch, moves created people out of the web, restores a changed ring, never deletes', () => {
    const s = { people: [{ id: 'p', name: 'Mira Test', ring: Ring.Close, lines: [] }], serviceImports: [] }
    commitPlan(s, planServices(s, [CHAT, LI], opts()), 'b1', NOW)
    for (const p of pendingProposals(s, NOW)) decide(s, 'b1', p.row.key, { do: 'change', ring: Ring.Friend }, NOW, newId)
    expect(s.people).toHaveLength(2)
    expect(s.people[0].ring).toBe(Ring.Friend)
    const r = undoBatch(s, 'b1')
    expect(r).toEqual({ restored: 1, archived: 1, kept: 0 })
    expect(s.serviceImports).toEqual([])
    expect(s.people).toHaveLength(2)
    expect(s.people[0].ring).toBe(Ring.Close)
    expect(s.people[0].sources ?? []).toEqual([])
    expect(s.people[1].ring).toBe(Ring.None)
  })
  it('undo leaves a person alone whose ring changed since the decision (counted as kept)', () => {
    const s = { people: [{ id: 'p', name: 'Mira Test', ring: Ring.Close, lines: [] }], serviceImports: [] }
    commitPlan(s, planServices(s, [CHAT, LI], opts()), 'b1', NOW)
    for (const p of pendingProposals(s, NOW)) decide(s, 'b1', p.row.key, { do: 'change', ring: Ring.Friend }, NOW, newId)
    s.people[0].ring = Ring.Closest // moved by hand since
    s.people[1].ring = Ring.Close // the created person got connected since
    const r = undoBatch(s, 'b1')
    expect(r).toEqual({ restored: 0, archived: 0, kept: 2 })
    expect(s.people[0].ring).toBe(Ring.Closest)
    expect(s.people[1].ring).toBe(Ring.Close)
  })
})

describe('ongoing sync: re-import diff (F3, T4)', () => {
  it('identical -> 0 added, 0 changed, all unchanged; a changed row -> changed 1; a new row -> added', () => {
    const s = fresh()
    commitPlan(s, planServices(s, [CHAT, LI], opts()), 'b1', NOW)
    expect(planServices(s, [CHAT, LI], opts()).diff).toEqual({ added: 0, changed: 0, unchanged: 2 })
    const newer = { name: '_chat.txt', text: CHAT.text + '\n[26.10.26, 09:00:00] Mira Test: more' }
    expect(planServices(s, [newer, LI], opts()).diff).toEqual({ added: 0, changed: 1, unchanged: 1 })
    commitPlan(s, planServices(s, [newer, LI], opts()), 'b2', NOW)
    expect(pendingProposals(s, NOW).map((p) => p.row.name)).toEqual(['Mira Test'])
    const more = { ...LI, text: LI.text + 'Berta,Probe,,,Foo,Bar,01 Sep 2025\n' }
    expect(planServices(s, [newer, more], opts()).diff).toEqual({ added: 1, changed: 0, unchanged: 2 })
  })
})

describe('privacy (T10)', () => {
  it('no network during plan, commit, propose', () => {
    const calls = []
    const orig = globalThis.fetch
    globalThis.fetch = (...a) => { calls.push(a); return Promise.reject(new Error('no')) }
    try {
      const s = fresh()
      commitPlan(s, planServices(s, [CHAT, LI], opts()), 'b1', NOW)
      pendingProposals(s, NOW)
    } finally { globalThis.fetch = orig }
    expect(calls).toHaveLength(0)
  })
})

describe('wave33 review fixes C1/C2/P6', () => {
  const csv = (body) => ({ name: 'c.csv', text: `name,phone,email\n${body}\n` })
  it('C1: national numbers keep their 0, 00 becomes +', () => {
    const plan = planServices(fresh(), [csv('Anna Berger,06641234567,\nCarl Zed,00436641234567,')], opts())
    expect(plan.rows.map((r) => r.phones)).toEqual([['06641234567'], ['+436641234567']])
  })
  it('C2: a same-name person gets no e-mail or phone from a row that shares none of theirs; Accept only stamps the source', () => {
    const s = { people: [{ id: 'a', name: 'Anna Berger', ring: Ring.Close, metAt: 0, lines: [] }], serviceImports: [] }
    const plan = planServices(s, [csv('Anna Berger,+436609998887,other.anna@y.de')], opts())
    commitPlan(s, plan, 'b1', NOW)
    decide(s, 'b1', plan.rows[0].key, { do: 'accept' }, NOW, newId)
    expect(s.people).toHaveLength(1)
    expect(s.people[0].fields).toBeUndefined()
    expect(s.people[0].channels).toBeUndefined()
    expect(s.people[0].sources).toHaveLength(1)
  })
  it('C2: explicit confirm writes the reach, undo takes it back', () => {
    const s = { people: [{ id: 'a', name: 'Anna Berger', ring: Ring.Close, metAt: 0, lines: [], fields: { note: 'mine' } }], serviceImports: [] }
    const plan = planServices(s, [csv('Anna Berger,+436609998887,other.anna@y.de')], opts())
    commitPlan(s, plan, 'b1', NOW)
    decide(s, 'b1', plan.rows[0].key, { do: 'accept', confirm: true }, NOW, newId)
    expect(s.people[0].fields.phone).toBe('+436609998887')
    undoBatch(s, 'b1')
    expect(s.people[0].fields).toEqual({ note: 'mine' })
    expect(s.people[0].sources ?? []).toHaveLength(0)
  })
  it('C2: a row whose e-mail matches links to that person despite another spelling of the name', () => {
    const s = { people: [{ id: 'a', name: 'Anna Berger', ring: Ring.Close, metAt: 0, lines: [], fields: { [EMAIL_FIELD]: 'anna@x.at' } }], serviceImports: [] }
    const plan = planServices(s, [csv('Anni Berger,+436601112223,anna@x.at')], opts())
    commitPlan(s, plan, 'b1', NOW)
    decide(s, 'b1', plan.rows[0].key, { do: 'accept' }, NOW, newId)
    expect(s.people).toHaveLength(1)
    expect(s.people[0].fields.phone).toBe('+436601112223')
  })
  it('P6: an imported number sets no messenger channel', () => {
    const s = fresh()
    const plan = planServices(s, [csv('Carl Zed,+436641234567,')], opts())
    commitPlan(s, plan, 'b1', NOW)
    decide(s, 'b1', plan.rows[0].key, { do: 'accept' }, NOW, newId)
    expect(s.people[0].fields.phone).toBe('+436641234567')
    expect(s.people[0].channels).toBeUndefined()
  })
})
