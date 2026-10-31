// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-host): which messenger "Chat" on a card opens, and the deep link it opens (messenger_links.ts). Pure. */
import { availableServices, chatTarget, noteUsed, openChat, pinService, shortcutSpec } from '../../src/messenger_links.ts'
import { Channel } from '../../src/model.ts'

const GEB = 'https://app.consensu.al/connect?to=did:peer:2.Vz6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK.Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc'
const ana = () => ({
  id: 'p1', name: 'Ana', peerId: 'peer-1',
  channels: { [Channel.Signal]: '+436601234567', [Channel.WhatsApp]: '+436601234567', [Channel.Matrix]: '@ana:matrix.org', [Channel.Consensual]: GEB },
})

describe('messenger links', () => {
  it('lists the services a person can be reached on, TrustWeb first', () => {
    expect(availableServices(ana())).toEqual(['trustweb', 'geb', 'signal', 'molly', 'whatsapp', 'matrix'])
    expect(availableServices({ id: 'p2', name: 'Bo' })).toEqual([])
    expect(availableServices({ id: 'p3', name: 'Cy', links: { signal: 'https://signal.me/#eu/abc' } })).toEqual(['signal', 'molly'])
  })
  it('builds each deep link in the format the messenger documents', () => {
    const p = ana()
    expect(chatTarget(p, 'trustweb')).toEqual({ service: 'trustweb', route: 'chat', personId: 'p1' })
    expect(chatTarget(p, 'signal')).toEqual({ service: 'signal', href: 'sgnl://signal.me/#p/+436601234567', fallback: 'https://signal.me/#p/+436601234567' })
    expect(chatTarget(p, 'molly')?.href).toBe('sgnl://signal.me/#p/+436601234567')
    expect(chatTarget(p, 'whatsapp')).toEqual({ service: 'whatsapp', href: 'https://wa.me/436601234567' })
    expect(chatTarget(p, 'matrix')).toEqual({ service: 'matrix', href: 'https://matrix.to/#/@ana:matrix.org' })
    expect(chatTarget(p, 'geb')).toEqual({ service: 'geb', href: 'https://app.consensu.al/chat?with=did:peer:2.Vz6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK.Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc' })
    expect(chatTarget({ id: 'p3', name: 'Cy', links: { signal: 'https://signal.me/#eu/abc' } }, 'signal')?.href).toBe('sgnl://signal.me/#eu/abc')
    expect(chatTarget({ id: 'p2', name: 'Bo' }, 'signal')).toBeNull()
  })
  it('opens the asked service, else the pinned one, else the last used, else the first', () => {
    const p = ana()
    expect(openChat([p], 'p1')?.service).toBe('trustweb')
    noteUsed(p, 'whatsapp')
    expect(p.chatLast).toBe('whatsapp')
    expect(openChat([p], 'p1')?.service).toBe('whatsapp')
    pinService(p, 'molly')
    expect(openChat([p], 'p1')?.service).toBe('molly')
    expect(openChat([p], 'p1', 'matrix')?.service).toBe('matrix')
    pinService(p, null)
    expect(p.chatPin).toBeUndefined()
    expect(openChat([p], 'p1')?.service).toBe('whatsapp')
    expect(openChat([p], 'nobody')).toBeNull()
  })
  it('a pinned or last service the person no longer has falls through', () => {
    const p = { id: 'p4', name: 'Di', peerId: 'peer-4', chatPin: 'signal', chatLast: 'matrix' }
    expect(openChat([p], 'p4')?.service).toBe('trustweb')
  })
  it('makes a home-screen shortcut spec for a link (geb ShortcutSpec shape), none for the in-app chat', () => {
    const p = ana()
    expect(shortcutSpec(p, chatTarget(p, 'molly'))).toEqual({ id: 'tw-molly-p1', label: 'Ana', deepLink: 'sgnl://signal.me/#p/+436601234567' })
    expect(shortcutSpec(p, chatTarget(p, 'trustweb'))).toBeNull()
    expect(shortcutSpec({ ...p, name: 'A'.repeat(60) }, chatTarget(p, 'matrix'))?.label).toHaveLength(40)
  })
})
