// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** @vitest-environment jsdom
 * Wave 44 steer-people-picker-2: zones of a scan, foreign person-bound codes refused, already-connected not re-added, placement under my code, Chat first, toast above sheets. */
import { readFileSync } from 'node:fs'
import { Ring } from '../../src/model.ts'
import { personQrLink, personQrTarget, foreignCode } from '../../src/person_qr_link.ts'
import { SCAN_RINGS, scanRing, placementOf, connectedPerson } from '../../src/scan_rules.ts'
import { renderConnectAdd } from '../../src/connect_add_view.ts'
import { S } from '../../src/strings.ts'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const base = 'https://app.example/c/xyz'

describe('zones of a scan (item 6)', () => {
  it('offers acquainted or closer only, never Intending', () => {
    expect(SCAN_RINGS).toEqual([Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance])
    expect(scanRing(Ring.Intending)).toBe(Ring.Acquaintance)
    expect(scanRing(Ring.Friend)).toBe(Ring.Friend)
  })
  it('the add sheet after a scan lists those four zones and starts on Acquaintances when handed Intending', () => {
    const h = renderConnectAdd({ name: 'Ben', ring: Ring.Intending, onAdd: () => {}, onLater: () => {} })
    const root = document.createElement('div')
    h.nodes.forEach((n) => root.append(n))
    const rings = [...root.querySelectorAll('[data-ring]')].map((b) => b.getAttribute('data-ring'))
    expect(rings).toEqual(['closest', 'close', 'friend', 'acquaintance'])
    expect(root.querySelector('[data-ring].on')?.getAttribute('data-ring')).toBe('acquaintance')
  })
})

describe('foreign scan of a person-bound code (item 2)', () => {
  const l = personQrLink(base, { id: 'p1', did: 'did:key:zBen', })
  it('the code carries the DID but no name', () => {
    expect(l).not.toMatch(/for=|Gruber/)
    expect(personQrTarget(l)).toBe('did:key:zBen')
  })
  it('is refused for another DID, ; accepted for the right one, for the open QR, and when only a local id is known', () => {
    expect(foreignCode(l, 'did:key:zOther')).toBe(true)
    expect(foreignCode(l, undefined)).toBe(true)
    expect(foreignCode(l, 'did:key:zBen')).toBe(false)
    expect(foreignCode(base, 'did:key:zOther')).toBe(false)
    expect(foreignCode(personQrLink(base, { id: 'p1' }), 'did:key:zOther')).toBe(false)
  })
  it('the refusal names nobody, and the flow refuses before anything is connected', () => {
    expect(S.w44pp2.foreign).toBe('This code was made for someone else. Ask the person who showed it to you for a code made for you (or their open QR).')
    const main = read('../../src/main.ts')
    const at = main.indexOf('async function completePendingConnect')
    const body = main.slice(at, main.indexOf('\n}\n', at))
    expect(body.indexOf('refuseForeign(')).toBeGreaterThan(0)
    expect(body.indexOf('refuseForeign(')).toBeLessThan(body.indexOf('admitLink('))
    expect(body.indexOf('refuseForeign(')).toBeLessThan(body.indexOf('net.completeConnect('))
    expect(main).toMatch(/function offerPendingConnect[\s\S]{0,200}refuseForeign\(/)
  })
})

describe('already connected (item 7)', () => {
  const s = { peers: [{ id: 'pe1', did: 'did:key:zBen' }], people: [{ id: 'a', name: 'Ben', peerId: 'pe1' }, { id: 'b', name: 'Cleo' }] }
  it('finds the card of a held DID, nothing for a stranger', () => {
    expect(connectedPerson(s, 'did:key:zBen')?.id).toBe('a')
    expect(connectedPerson(s, 'did:key:zNew')).toBeUndefined()
  })
  it('an event or tag code from a held person skips completeConnect and only joins', () => {
    const main = read('../../src/main.ts')
    const at = main.indexOf('async function completePendingConnect')
    const body = main.slice(at, main.indexOf('\n}\n', at))
    const held = body.indexOf('connectedPerson(')
    expect(held).toBeGreaterThan(0)
    expect(held).toBeLessThan(body.indexOf('net.completeConnect('))
    expect(body.slice(held, body.indexOf('net.completeConnect('))).toMatch(/alreadyConnected[\s\S]*afterConnectOpen/)
    expect(S.w44pp2.alreadyConnected('Ben')).toBe('Already connected with Ben.')
  })
})

describe('placement under my own code (item 5)', () => {
  it('the choice is one of the scan zones, else the default zone', () => {
    expect(placementOf({}, Ring.Acquaintance)).toBe(Ring.Acquaintance)
    expect(placementOf({ connectPlacement: Ring.Friend }, Ring.Acquaintance)).toBe(Ring.Friend)
    expect(placementOf({ connectPlacement: Ring.Intending }, Ring.Acquaintance)).toBe(Ring.Acquaintance)
  })
  it('a person who scans lands in the chosen zone (Net ringForNewPeer) and the Meet page offers the dropdown and the scan button right under the code', () => {
    const main = read('../../src/main.ts')
    expect(main).toMatch(/ringForNewPeer: \(\) => placementOf\(st\(\)/)
    const page = main.slice(main.indexOf("el('div', { class: 'meet-qr-col'"))
    const col = page.slice(0, page.indexOf("el('div', { class: 'meet-rest' }"))
    expect(col.indexOf('qr,')).toBeLessThan(col.indexOf('scan.button'))
    expect(col.indexOf('scan.button')).toBeLessThan(col.indexOf('placementRow()'))
    expect(S.w44pp2.placedIn).toBe('They will be placed in:')
  })
})

describe('Chat first, toast above sheets (items 8, 9)', () => {
  it('the small card and the old sheet start with the Chat row', () => {
    const card = read('../../src/membranes_five_view.ts')
    expect(card.indexOf("'data-chat-row'")).toBeLessThan(card.indexOf("'card-name-row'"))
    const main = read('../../src/main.ts')
    const sheet = main.slice(main.indexOf('function personSheet'))
    expect(sheet.indexOf('cardChatButton(p')).toBeLessThan(sheet.indexOf('cardNameHeading(p)'))
    expect(main).toMatch(/function curatorPerson[\s\S]{0,400}cardChatButton\(p, false\)[\s\S]{0,100}curator\.person/)
  })
  it('while a sheet is open the notice layer sits at the top, not over the sheet buttons', () => {
    expect(read('../../src/styles.css')).toMatch(/\.phone:has\(\.sheet\.on\) #notice-layer\{bottom:auto; top:/)
  })
  it('member tiles grow instead of clipping the name', () => {
    const css = read('../../src/ext/community-mighty/community.css')
    expect(css).toMatch(/wave44 steer-people-picker-2[\s\S]*\.members \.card\.member\{height:auto/)
  })
})

describe('MCP parity (item 5, 2, 7)', () => {
  it('connect_placement(_set) and connect_link_check exist and work on the record', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const { recordTools } = await import('../../../mcp/src/record_tools.ts')
    const { MCP_TOOLS } = await import('../../src/ext/mcp-local/mcp_config.ts')
    for (const n of ['connect_placement', 'connect_placement_set', 'connect_link_check']) expect(MCP_TOOLS.map((t) => t.name)).toContain(n)
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-pp2-')), 'r.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { displayName: 'J' }, identity: { did: 'did:key:zMe' }, peers: [{ id: 'pe1', did: 'did:key:zBen' }], people: [{ id: 'a', name: 'Ben', ring: 'friend', peerId: 'pe1', lines: [], metAt: 1 }], sameAs: {}, meetings: [] }))
    const by = Object.fromEntries(recordTools({ file, write: true, now: () => new Date() }).map((t) => [t.name, t]))
    expect(by.connect_placement.run({}).zone).toBe('acquaintance')
    expect(by.connect_placement_set.run({ zone: 'friend' })).toEqual({ zone: 'friend' })
    expect(by.connect_placement.run({}).zone).toBe('friend')
    expect(() => by.connect_placement_set.run({ zone: 'intending' })).toThrow()
    expect(by.connect_link_check.run({ link: personQrLink(base, { id: 'x', did: 'did:key:zOther' }) })).toEqual({ result: 'refused' })
    expect(by.connect_link_check.run({ link: base, did: 'did:key:zBen' })).toMatchObject({ result: 'already-connected', person: 'a' })
    expect(by.connect_link_check.run({ link: base, did: 'did:key:zNew' })).toEqual({ result: 'new' })
  })
})
