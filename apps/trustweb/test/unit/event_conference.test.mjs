// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c event-autosave (zeta, Jakob: "only once the person has accepted it should be revealed"): the conference link of an event never travels
 * in its link, QR or invite; a guest who says "I will attend" gets it from the host's device, sealed; a guest who has not answered or declined sees
 * "Revealed once you accept". Fake names and links only.
 */
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { decodeEventLink, encodeEventLink, fromBase64Url, shortFields } from '../../src/event_link.ts'
import { newEvent } from '../../src/events.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { conferenceState, attendChanged } from '../../src/event_conference.ts'
import { S } from '../../src/strings.ts'

const ORIGIN = 'https://app.trustweb.one'
const URL_ = 'https://kmeet.infomaniak.com/secret-room-77'
const HOST = 'Hanna Host'
const GUEST = 'Gabi Guest'
const hostEvent = () => ({ ...newEvent({ name: 'Online circle', from: '2026-12-30', where: 'Online', hosts: [HOST] }, 'ev1', 5), conference: [{ provider: 'kmeet', url: URL_ }] })
const guestEvent = (over = {}) => {
  const linked = decodeEventLink(encodeEventLink(hostEvent(), ORIGIN, 'peer', { name: HOST }).split('/')[3])
  const { kind: _k, ...rest } = linked
  return { ...rest, createdAt: 1, attended: false, fromLink: true, ...over }
}

describe('projection: no conference link in what travels', () => {
  it('the event link, its short QR form and an event envelope carry no conference link, only that one waits', () => {
    const ev = hostEvent()
    const long = encodeEventLink(ev, ORIGIN, 'peer', { name: HOST })
    const host = encodeEventLink(ev, ORIGIN, 'host', { name: HOST })
    for (const l of [long, host]) expect(fromBase64Url(new URLSearchParams(l.slice(l.indexOf('#') + 1)).get(l.includes('#ev_host=') ? 'ev_host' : 'ev'))).not.toContain('kmeet')
    expect(JSON.stringify(decodeEventLink(long.slice(long.indexOf('#'))))).not.toContain(URL_)
    expect(shortFields(ev)).not.toContain('kmeet')
    expect(decodeEventLink(long.slice(long.indexOf('#'))).confHidden).toBe(true)
    const plain = encodeEventLink({ ...ev, conference: undefined }, ORIGIN, 'peer')
    expect(decodeEventLink(plain.slice(plain.indexOf('#'))).confHidden).toBeUndefined()
  })
})

describe('wire: rsvp and conf envelopes', () => {
  it('round trip; nothing else is read', () => {
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } }))).toEqual({ v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } })
    const conf = { v: 1, t: 'event', conf: { id: 'ev1', links: [{ provider: 'kmeet', url: URL_ }] } }
    expect(decodeFromQr(encodeForQr(conf))).toEqual(conf)
    expect(decodeFromQr(JSON.stringify({ ...conf, extra: 1 }))).toEqual(conf)
  })
  it('rejects a bad id, a non-boolean answer, a non-https or too many links, or a mix with link/want', () => {
    for (const bad of [{ rsvp: { id: 'has space', yes: true } }, { rsvp: { id: 'ev1', yes: 'yes' } }, { conf: { id: 'ev1', links: [{ provider: 'kmeet', url: 'http://x.example' }] } },
      { conf: { id: 'ev1', links: Array.from({ length: 9 }, () => ({ provider: 'zoom', url: URL_ })) } }, { conf: { id: 'ev1', links: [{ provider: 'skype', url: URL_ }] } },
      { rsvp: { id: 'ev1', yes: true }, want: 'ev1' }, { conf: { id: 'ev1', links: [] }, link: 'x' }]) {
      expect(decodeFromQr(JSON.stringify({ v: 1, t: 'event', ...bad }))).toBeNull()
    }
  })
})

function side(name, events, people = []) {
  const sent = []
  const state = { events, me: { id: name, displayName: name }, people, peers: [{ id: 'peerX' }] }
  const env = createEventEnvelopes({
    state: () => state, save: () => {}, now: () => 1000, link: (ev) => encodeEventLink(ev, ORIGIN, 'peer'), send: async (p, e) => { sent.push({ to: p.id, env: e }) },
    pending: () => null, setPending: () => {}, changed: () => {}, later: () => {}, peers: () => state.peers,
  })
  return { state, env, sent }
}

describe('the reveal flow (controller)', () => {
  it('the guest says yes: an rsvp goes to the host only; the host answers with the link; the guest shows it', async () => {
    const g = side(GUEST, [guestEvent()], [{ id: 'h', name: HOST, peerId: 'peerX' }, { id: 'o', name: 'Other', peerId: 'peerY' }])
    g.state.peers.push({ id: 'peerY' })
    expect(conferenceState(g.state.events[0])).toBe('hidden')
    g.state.events[0].attended = true
    expect(attendChanged(g.state, g.state.events[0])).toBe(true)
    await g.env.rsvp(g.state.events[0])
    expect(g.sent).toEqual([{ to: 'peerX', env: { v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } } }])
    expect(conferenceState(g.state.events[0])).toBe('asked')

    const h = side(HOST, [hostEvent()], [{ id: 'g', name: GUEST, peerId: 'peerX' }])
    expect(await h.env.onEnvelope({ id: 'peerX' }, g.sent[0].env)).toBe('answered')
    expect(h.sent).toEqual([{ to: 'peerX', env: { v: 1, t: 'event', conf: { id: 'ev1', links: [{ provider: 'kmeet', url: URL_ }] } } }])
    expect(h.state.events[0].confTo).toEqual(['peerX'])

    expect(await g.env.onEnvelope({ id: 'peerX' }, h.sent[0].env)).toBe('filled')
    expect(conferenceState(g.state.events[0])).toEqual({ links: [{ provider: 'kmeet', url: URL_ }] })
  })
  it('a host change reaches the guests who accepted; a no takes the guest off the list', async () => {
    const h = side(HOST, [{ ...hostEvent(), confTo: ['peerX'] }])
    h.state.events[0].conference = [{ provider: 'zoom', url: 'https://zoom.example/j/1' }]
    await h.env.pushConference(h.state.events[0])
    expect(h.sent.map((s) => s.env.conf.links[0].provider)).toEqual(['zoom'])
    expect(await h.env.onEnvelope({ id: 'peerX' }, { v: 1, t: 'event', rsvp: { id: 'ev1', yes: false } })).toBe('answered')
    expect(h.state.events[0].confTo).toBeUndefined()
    expect(h.sent).toHaveLength(1)
  })
  it('the host never answers a no, an unknown event, or an event without a link; a non-host never answers', async () => {
    const h = side(HOST, [{ ...hostEvent(), conference: undefined }])
    expect(await h.env.onEnvelope({ id: 'peerX' }, { v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } })).toBe('ignored')
    expect(await h.env.onEnvelope({ id: 'peerX' }, { v: 1, t: 'event', rsvp: { id: 'nope', yes: true } })).toBe('ignored')
    const notHost = side('Somebody', [{ ...hostEvent(), fromLink: true }])
    expect(await notHost.env.onEnvelope({ id: 'peerX' }, { v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } })).toBe('ignored')
    expect([...h.sent, ...notHost.sent]).toEqual([])
  })
  it('the guest takes a link only from a host and only after accepting', async () => {
    const conf = { v: 1, t: 'event', conf: { id: 'ev1', links: [{ provider: 'kmeet', url: URL_ }] } }
    const notYet = side(GUEST, [guestEvent()], [{ id: 'h', name: HOST, peerId: 'peerX' }])
    expect(await notYet.env.onEnvelope({ id: 'peerX' }, conf)).toBe('ignored')
    const stranger = side(GUEST, [guestEvent({ attended: true })], [{ id: 'o', name: 'Other', peerId: 'peerX' }])
    expect(await stranger.env.onEnvelope({ id: 'peerX' }, conf)).toBe('ignored')
    expect(stranger.state.events[0].conference).toBeUndefined()
  })
  it("declining hides the link again; the host's own event is never hidden and sends no rsvp", () => {
    const g = { events: [guestEvent({ attended: false, conference: [{ provider: 'kmeet', url: URL_ }] })], me: { displayName: GUEST }, people: [] }
    expect(attendChanged(g, g.events[0])).toBe(true)
    expect(g.events[0].conference).toBeUndefined()
    expect(conferenceState(g.events[0])).toBe('hidden')
    const h = { events: [hostEvent()], me: { displayName: HOST }, people: [] }
    expect(attendChanged(h, h.events[0])).toBe(false)
    expect(conferenceState(h.events[0])).toEqual({ links: [{ provider: 'kmeet', url: URL_ }] })
    expect(conferenceState({ ...hostEvent(), conference: undefined })).toBeNull()
  })
  it('says "Revealed once you accept"', () => {
    expect(S.evConf44c.hidden).toBe('Revealed once you accept')
  })
})
