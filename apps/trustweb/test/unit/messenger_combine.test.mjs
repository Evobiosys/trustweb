// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 messengers-combined: one chat view over TrustWeb + Matrix + Geb + Signal (messenger_combine.ts, messenger_detect.ts). Pure. */
import { SOURCE_COLOR, listEntries, mergeThreads, parseOff, parseSelection, sourceColor, toggleSource, usableSelection, viewTitle, hideNewerThan, focusRows } from '../../src/messenger_combine.ts'
import { detectGeb } from '../../src/messenger_detect.ts'

const t = (id, lastAt) => ({ id, title: id, lastAt, unread: 0 })
const src = (id, status) => ({ id, label: id.toUpperCase(), status: () => status })

describe('messenger combine', () => {
  it('merges three sources by time, newest first, each row tagged with its source', () => {
    const rows = mergeThreads({ trustweb: [t('a', 10), t('b', 40)], matrix: [t('m', 30)], geb: [t('g', 20)] })
    expect(rows.map((r) => r.id)).toEqual(['b', 'm', 'g', 'a'])
    expect(rows.map((r) => r.source)).toEqual(['trustweb', 'matrix', 'geb', 'trustweb'])
  })
  it('equal times keep the order the sources were given', () => {
    expect(mergeThreads({ trustweb: [t('a', 5)], matrix: [t('m', 5)] }).map((r) => r.id)).toEqual(['a', 'm'])
  })
  it('every source has its own bracket colour; an unknown one gets a neutral', () => {
    const cols = ['trustweb', 'matrix', 'geb', 'signal-link'].map(sourceColor)
    expect(new Set(cols).size).toBe(4)
    expect(Object.keys(SOURCE_COLOR)).toEqual(['trustweb', 'matrix', 'geb', 'signal-link'])
    expect(sourceColor('nope')).toBe('var(--ink-soft)')
  })
  it('switcher list: TrustWeb always on, set-up sources on, the rest greyed with setup, switched-off ones hidden', () => {
    const e = listEntries([src('matrix', 'live'), src('geb', 'needs-setup'), src('signal-link', 'archive')], new Set(['signal-link']))
    expect(e.map((x) => [x.id, x.state])).toEqual([['trustweb', 'on'], ['matrix', 'on'], ['geb', 'setup']])
  })
  it('a source switched off is filtered out of the chosen selection too', () => {
    const e = listEntries([src('matrix', 'live')], new Set(['matrix']))
    expect(usableSelection(['trustweb', 'matrix'], e)).toEqual(['trustweb'])
  })
  it('a source that needs setup is not part of the combined view', () => {
    const e = listEntries([src('geb', 'needs-setup'), src('matrix', 'live')], new Set())
    expect(usableSelection(['geb', 'matrix'], e)).toEqual(['matrix'])
    expect(usableSelection(['geb'], e)).toEqual(['trustweb'])
  })
  it('toggling keeps at least one source', () => {
    expect(toggleSource(['trustweb'], 'matrix')).toEqual(['trustweb', 'matrix'])
    expect(toggleSource(['trustweb', 'matrix'], 'matrix')).toEqual(['trustweb'])
    expect(toggleSource(['matrix'], 'matrix')).toEqual(['matrix'])
  })
  it('the header names the view', () => {
    const labels = { trustweb: 'TrustWeb', matrix: 'Matrix', geb: 'Geb', 'signal-link': 'Signal' }
    expect(viewTitle(['trustweb'], labels, 'All')).toBe('TrustWeb')
    expect(viewTitle(['matrix'], labels, 'All')).toBe('Matrix')
    expect(viewTitle(['trustweb', 'signal-link'], labels, 'All')).toBe('TrustWeb + Signal')
    expect(viewTitle(['trustweb', 'matrix', 'geb'], labels, 'All', 3)).toBe('All')
  })
  it('selection and off-list parse defensively', () => {
    expect(parseSelection(null)).toEqual(['trustweb'])
    expect(parseSelection('{')).toEqual(['trustweb'])
    expect(parseSelection('["matrix",7,"geb"]')).toEqual(['matrix', 'geb'])
    expect(parseOff('["matrix"]').has('matrix')).toBe(true)
    expect(parseOff('x').size).toBe(0)
  })
  it('Do Not Disturb shows the last state: threads newer than the moment it was switched on are dropped', () => {
    const rows = mergeThreads({ trustweb: [t('old', 10), t('new', 90)] })
    expect(hideNewerThan(rows, 50).map((r) => r.id)).toEqual(['old'])
    expect(hideNewerThan(rows, undefined).length).toBe(2)
  })
})

describe('distraction-free: only this chat', () => {
  it('one picked row stays, nothing picked shows all', () => {
    const rows = mergeThreads({ trustweb: [t('a', 1)], matrix: [t('a', 2)] })
    expect(focusRows(rows, 'matrix:a').map((r) => r.source)).toEqual(['matrix'])
    expect(focusRows(rows, null).length).toBe(2)
  })
})

describe('geb detection', () => {
  const env = (o) => ({ paired: false, marker: false, ping: async () => true, ...o })
  it('paired and the bridge answers: live', async () => { expect(await detectGeb(env({ paired: true }))).toBe('live') })
  it('paired but the bridge is down: falls back to the page marker', async () => {
    expect(await detectGeb(env({ paired: true, ping: async () => { throw new Error('down') }, marker: true }))).toBe('installed')
  })
  it('not paired, Geb marked in this browser: installed (needs pairing)', async () => { expect(await detectGeb(env({ marker: true }))).toBe('installed') })
  it('nothing found: absent', async () => { expect(await detectGeb(env({}))).toBe('absent') })
})
