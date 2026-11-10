// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 40 photo-rails: the module's record slice, and the share rail: one share line + one bundle entry, sealed per recipient.
import { MODULE_ID, mergePhotos, parsePhotos, photosDbName } from '../../src/ext/photos/photos_data.ts'
import { bundleItem, openBundle, planShare, sealBundleFor } from '../../src/ext/photos/photo_share.ts'
import { createIdentity } from '../../../demo/src/did.ts'
import { Ring } from '../../src/model.ts'
import { Zone } from '../../src/share_sink/zones.ts'

const NOW = new Date('2026-11-10T09:00:00Z')

describe('slice', () => {
  it('parses only known fields and checks each', () => {
    expect(MODULE_ID).toBe('photos')
    expect(parsePhotos(null)).toEqual({})
    expect(parsePhotos({ faceMatch: true, evil: 1, bundles: [{ id: 'b', photoIds: ['1'], hashes: ['h'], scope: { zone: 'friend', include: [], exclude: [] }, createdAt: 5, recipients: ['p'], transport: 'stub' }, { id: 7 }] }))
      .toEqual({ faceMatch: true, bundles: [{ id: 'b', photoIds: ['1'], hashes: ['h'], scope: { zone: 'friend', include: [], exclude: [] }, createdAt: 5, recipients: ['p'], transport: 'stub' }] })
    expect(parsePhotos({ faceMatch: 'yes' })).toEqual({})
    expect(parsePhotos({ bundles: [{ id: 'b', photoIds: ['1'], hashes: ['h'], scope: { zone: 'nonsense', include: [], exclude: [] }, createdAt: 5, recipients: [], transport: 'stub' }] })).toEqual({})
  })
  it('merges two devices: bundles join by id, the switch follows the incoming side', () => {
    const b = (id) => ({ id, photoIds: ['1'], hashes: ['h'], scope: { zone: 'friend', include: [], exclude: [] }, createdAt: 1, recipients: [], transport: 'stub' })
    const m = mergePhotos({ faceMatch: true, bundles: [b('x')] }, { bundles: [b('x'), b('y')] })
    expect(m.bundles.map((x) => x.id)).toEqual(['x', 'y'])
    expect(m.faceMatch).toBe(true)
    expect(mergePhotos({ faceMatch: true }, { faceMatch: false }).faceMatch).toBe(false)
  })
  it('the database is named per person of this record', () => { expect(photosDbName('did:x:abc')).toBe('trustweb-photos.did:x:abc') })
})

describe('share rail', () => {
  const people = [
    { id: 'p1', name: 'Ana', context: '', ring: Ring.Friend, metAt: 0, lines: [] },
    { id: 'p2', name: 'Ben', context: '', ring: Ring.Acquaintance, metAt: 0, lines: [] },
    { id: 'p3', name: 'Cy', context: '', ring: Ring.Close, metAt: 0, lines: [] },
  ]
  const basis = { people, tags: [], shares: [] }
  const photos = [{ id: 'ph1', hash: 'h1' }, { id: 'ph2', hash: 'h2' }]

  it('a share to a zone previews who would see it, by the same check as every share', () => {
    const plan = planShare(basis, { photos, scope: { zone: Zone.Friend, include: [], exclude: [] }, now: NOW, newId: () => 'b1' })
    expect(plan.preview.names.sort()).toEqual(['Ana', 'Cy'])
    expect(plan.bundle).toMatchObject({ id: 'b1', photoIds: ['ph1', 'ph2'], hashes: ['h1', 'h2'], transport: 'stub', recipients: ['p1', 'p3'] })
    expect(plan.lines.at(-1)).toMatchObject({ op: 'share', id: `item:${bundleItem('b1')}`, to: 'zone:friend' })
  })
  it('exclude beats the zone; include reaches a person outside it', () => {
    const plan = planShare(basis, { photos, scope: { zone: Zone.Friend, include: ['person:p2'], exclude: ['person:p3'] }, now: NOW, newId: () => 'b2' })
    expect(plan.bundle.recipients.sort()).toEqual(['p1', 'p2'])
  })
  it('refuses an empty selection', () => {
    expect(planShare(basis, { photos: [], scope: { zone: Zone.Friend, include: [], exclude: [] }, now: NOW, newId: () => 'b' })).toBeNull()
  })
  it('seals the manifest for one recipient; only that recipient opens it; the photos themselves are not in it', async () => {
    const ana = createIdentity('https://x.invalid/relay')
    const ben = createIdentity('https://x.invalid/relay')
    const eve = createIdentity('https://x.invalid/relay')
    const plan = planShare(basis, { photos, scope: { zone: Zone.Friend, include: [], exclude: [] }, now: NOW, newId: () => 'b3' })
    const sealed = await sealBundleFor(plan.bundle, ana, ben.did)
    const opened = await openBundle(sealed, ben, ana.did)
    expect(opened).toMatchObject({ kind: 'photo-bundle', v: 1, id: 'b3', hashes: ['h1', 'h2'], count: 2 })
    expect(JSON.stringify(opened)).not.toMatch(/blob|data:image/)
    expect(await openBundle(sealed, eve, ana.did)).toBeNull()
  })
})
