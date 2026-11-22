// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 community-documents: the community's documents list (what the Community view shows after "by <community>") and its MCP read tool. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { documentsOf } from '../../src/ext/community-mighty/community_model'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const res = (id, title) => ({ id, title, url: `https://example.org/${id}`, by: 'me', at: 1 })

describe('documentsOf', () => {
  it('lists the shared links in my order, hidden ones left out', () => {
    const d = { resources: [res('a', 'Charter'), res('b', 'Minutes'), res('c', 'Budget')], mine: { owner: 'me', order: ['c', 'a'], hidden: ['b'] } }
    expect(documentsOf(d).map((r) => r.id)).toEqual(['c', 'a'])
  })
  it('keeps what others added since (new) and is empty without resources', () => {
    expect(documentsOf({ resources: [res('a', 'Charter')] }).map((r) => r.id)).toEqual(['a'])
    expect(documentsOf({})).toEqual([])
  })
})

describe('community_documents_list', () => {
  const fixture = (write = false) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-cd-')), 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, people: [], me: { displayName: 'T' }, events: [], sameAs: {}, meetings: [], extData: { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [] } }, resources: [res('a', 'Charter')] } } }))
    return Object.fromEntries(recordTools({ file, write, now: () => new Date('2026-11-19T10:00:00Z') }).map((t) => [t.name, t]))
  }
  it('is a read tool and answers title, url, by', () => {
    const by = fixture(false)
    expect(by.community_documents_list.run({ community: 'iyg' })).toEqual([{ id: 'a', title: 'Charter', url: 'https://example.org/a', by: 'me' }])
    expect(() => by.community_documents_list.run({ community: 'nope' })).toThrow(/no community/)
  })
})
