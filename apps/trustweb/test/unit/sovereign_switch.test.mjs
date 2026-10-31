// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (sovereign-switch): export everything, and the other-services checklist (sovereign_switch.ts). Made-up data only. */
import { exportFiles, exportName, mailtoFor, markService, nextToExport, requestText } from '../../src/sovereign_switch.ts'
import { SERVICES_RTBF } from '../../src/data/services_rtbf.ts'

const NOW = new Date(2026, 9, 31, 9, 5).getTime()
const state = () => ({
  v: 1, me: { id: 'me1', displayName: 'Test Owner' }, identity: { secret: 'k' }, notificationsOn: false, log: [],
  people: [{ id: 'p1', name: 'Ana Test', context: 'garden', ring: 'friend', metAt: 1, lines: [{ id: 'l1', text: 'has a ladder', tag: 'offer' }], fields: { fam: 'true' } }],
  peers: [{ id: 'peer1', displayName: 'Ana', did: 'did:x', ring: 'friend', connectedAt: 2 }],
  inventory: [{ id: 'i1', text: 'Cargo bike\nto lend', audience: 'friends', included: true, createdAt: 3 }],
  events: [{ id: 'e1', name: 'Garden day', from: '2026-11-01T10:00' }],
  tasks: [{ id: 't1', title: 'Water plants' }],
  received: [{ id: 'r1', at: 4, fromName: 'Ana', fromPeerId: 'peer1', link: 'https://x/#s', title: 'Notes' }],
  meetings: [{ id: 'm1', about: 'Ana', at: 5, lines: [{ speaker: 0, at: 0, text: 'hello' }] }],
  chats: { peer1: { messages: [{ from: 'me', text: 'hi', ts: 6 }, { from: 'peer1', text: 'yo', ts: 7 }] } },
})

describe('sovereign switch: export', () => {
  it('names the file by local date and minute', () => {
    expect(exportName(NOW)).toBe('trustweb-export-20261031-0905.zip')
  })
  it('holds the full record, one log line per node, Markdown per kind and a README', () => {
    const s = state()
    const files = Object.fromEntries(exportFiles(s, NOW).map((f) => [f.name, f.data]))
    expect(Object.keys(files)).toEqual(['README.md', 'record.json', 'log.jsonl', 'people.md', 'resources.md', 'events.md', 'tasks.md', 'shares.md', 'meetings.md', 'chats.md', 'settings.md'])
    expect(JSON.parse(files['record.json'])).toEqual(s)
    const log = files['log.jsonl'].trim().split('\n').map((l) => JSON.parse(l))
    expect(log.map((l) => [l.seq, l.op, l.kind])).toEqual([
      [1, 'create_node', 'person'], [2, 'create_node', 'resource'], [3, 'create_node', 'event'], [4, 'create_node', 'task'],
      [5, 'create_node', 'share'], [6, 'create_node', 'meeting'], [7, 'create_node', 'chat'], [8, 'create_node', 'settings'],
    ])
    expect(log.every((l) => l.ts === NOW)).toBe(true)
    // Chats: metadata only, never the message bodies (they stay in record.json, where they already are).
    expect(log[6].node).toEqual({ peerId: 'peer1', messages: 2, firstTs: 6, lastTs: 7 })
    expect(files['log.jsonl']).not.toContain('"yo"')
    // Settings: what is not a node, without the identity keys.
    expect(log[7].node.identity).toBeUndefined()
    expect(log[7].node.people).toBeUndefined()
    expect(log[7].node.notificationsOn).toBe(false)
  })
  it('writes Logseq-style outliner Markdown with properties, one line per value', () => {
    const files = Object.fromEntries(exportFiles(state(), NOW).map((f) => [f.name, f.data]))
    expect(files['people.md']).toBe('- Ana Test\n  id:: p1\n  ring:: friend\n  context:: garden\n  tags:: fam\n  - has a ladder\n')
    expect(files['resources.md']).toBe('- Cargo bike to lend\n  id:: i1\n  audience:: friends\n  shared:: true\n')
    expect(files['chats.md']).toBe('- peer1\n  messages:: 2\n  first:: 1970-01-01T00:00:00.006Z\n  last:: 1970-01-01T00:00:00.007Z\n')
    expect(files['README.md']).toContain('record.json')
  })
  it('exports an empty record too', () => {
    const files = exportFiles({ v: 1, me: { id: 'm', displayName: 'X' }, people: [], peers: [], inventory: [], log: [], notificationsOn: true }, NOW)
    const md = files.find((f) => f.name === 'people.md')
    expect(md.data).toBe('')
  })
})

describe('sovereign switch: other services', () => {
  it('the registry lists the asked services, each with links and a verified flag', () => {
    const ids = SERVICES_RTBF.map((s) => s.id)
    for (const id of ['google', 'facebook', 'instagram', 'whatsapp', 'threads', 'linkedin', 'x', 'tiktok', 'apple', 'microsoft', 'amazon', 'spotify', 'telegram', 'snapchat', 'pinterest', 'reddit', 'discord', 'zoom', 'dropbox', 'strava', 'signal']) expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SERVICES_RTBF) {
      expect(typeof s.verified).toBe('boolean')
      for (const u of [s.exportUrl, s.deleteUrl]) if (u) expect(u).toMatch(/^https:\/\//)
      if (s.email) expect(s.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/)
    }
    expect(SERVICES_RTBF.find((s) => s.id === 'signal').note).toBeTruthy()
  })
  it('fills the GDPR Art. 17 + 20 request in English and German', () => {
    const fill = { name: 'Test Owner', account: 'test@example.org', date: '2026-10-31' }
    const en = requestText('en', 'Spotify', fill)
    expect(en.subject).toContain('Article 17')
    expect(en.body).toContain('Article 20')
    expect(en.body).toContain('test@example.org')
    expect(en.body).toContain('Test Owner')
    const de = requestText('de', 'Spotify', fill)
    expect(de.subject).toContain('Art. 17')
    expect(de.body).toContain('Löschung')
    expect(de.body).toContain('2026-10-31')
  })
  it('builds a mailto: to the privacy address, or to nobody when there is none', () => {
    const fill = { name: 'A', account: 'b', date: 'c' }
    const withMail = { id: 'z', name: 'Z', email: 'privacy@example.org', verified: false }
    expect(mailtoFor(withMail, 'en', fill)).toMatch(/^mailto:privacy@example\.org\?subject=.+&body=.+/)
    expect(mailtoFor({ id: 'y', name: 'Y', verified: false }, 'de', fill)).toMatch(/^mailto:\?subject=/)
  })
  it('ticks are kept with their date; the switch opens the first service not yet asked for its export', () => {
    const s = { sovereign: undefined }
    const list = [{ id: 'a', name: 'A', exportUrl: 'https://a', verified: false }, { id: 'b', name: 'B', exportUrl: 'https://b', verified: false }, { id: 'c', name: 'C', verified: false }]
    expect(nextToExport(list, s)?.id).toBe('a')
    markService(s, 'a', 'export', 10)
    expect(s.sovereign.services.a).toEqual({ exportAt: 10 })
    expect(nextToExport(list, s)?.id).toBe('b')
    markService(s, 'b', 'export', 11)
    markService(s, 'b', 'delete', 12)
    expect(s.sovereign.services.b).toEqual({ exportAt: 11, deleteAt: 12 })
    expect(nextToExport(list, s)).toBeNull() // c has no export link
    markService(s, 'a', 'export', null)
    expect(s.sovereign.services.a).toBeUndefined()
  })
})
