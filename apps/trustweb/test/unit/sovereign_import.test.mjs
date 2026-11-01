// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 (sovereign-import): service order, estimates, export-mail watcher, verify gate, Advanced split, swappable search block. Made-up data only. */
import { DEFAULT_ESTIMATE, MAIN_ORDER, SERVICES_RTBF, mainServices, otherServices } from '../../src/data/services_rtbf.ts'
import { LINK_TTL_MS, WAIT_MAX_MS, matchMail, startWatch, watchStep } from '../../src/export_watch.ts'
import { MIN_TOTAL_BYTES, serviceForArchive, verifyArchive } from '../../src/takeout_verify.ts'
import { pageSections } from '../../src/sovereign_switch.ts'
import { SEARCH_CONFIG, rank, registerRankAdapter } from '../../src/search_rank.ts'

const svc = (id) => SERVICES_RTBF.find((s) => s.id === id)

describe('sovereign import: services', () => {
  it('lists WhatsApp first, then Google, Facebook, Instagram, X, LinkedIn, Amazon, Spotify, Reddit', () => {
    expect(mainServices().map((s) => s.id)).toEqual(['whatsapp', 'google', 'facebook', 'instagram', 'x', 'linkedin', 'amazon', 'spotify', 'reddit'])
    expect(MAIN_ORDER.length).toBe(9)
  })
  it('moves Strava, Pinterest, Snapchat, TikTok and Threads under Other services', () => {
    const other = otherServices().map((s) => s.id)
    for (const id of ['strava', 'pinterest', 'snapchat', 'tiktok', 'threads']) expect(other).toContain(id)
    expect(mainServices().some((s) => other.includes(s.id))).toBe(false)
    expect(new Set([...mainServices(), ...otherServices()].map((s) => s.id)).size).toBe(SERVICES_RTBF.length)
  })
  it('gives every main service an estimate and something to look out for', () => {
    for (const s of mainServices()) { expect(s.estimate, s.id).toBeTruthy(); expect(s.watchFor?.length, s.id).toBeGreaterThan(0) }
    expect(DEFAULT_ESTIMATE).toBe('usually 10 min to 2 days')
  })
  it('keeps unverified entries marked', () => {
    expect(SERVICES_RTBF.every((s) => s.verified === false)).toBe(true)
  })
})

describe('sovereign import: export-mail watcher', () => {
  const T0 = 1_000_000
  const mail = { from: 'no-reply@accounts.google.com', subject: 'Your Google data export is ready', url: 'https://takeout.google.com/x' }
  it('matches the export mail by sender domain, https link and subject', () => {
    expect(matchMail(svc('google'), mail)).toBe(true)
    expect(matchMail(svc('google'), { ...mail, from: 'a@evil-google.com.example.org' })).toBe(false)
    expect(matchMail(svc('google'), { ...mail, url: 'http://takeout.google.com/x' })).toBe(false)
    expect(matchMail(svc('google'), { ...mail, subject: 'Hello' })).toBe(false)
    expect(matchMail(svc('whatsapp'), mail)).toBe(false)
  })
  it('runs waiting -> link seen -> importing -> done', () => {
    let w = startWatch(T0)
    expect(w.state).toBe('waiting')
    w = watchStep(w, { type: 'mail', mail }, T0 + 10)
    expect(w).toMatchObject({ state: 'link_seen', url: mail.url, linkAt: T0 + 10 })
    w = watchStep(w, { type: 'import' }, T0 + 20)
    expect(w.state).toBe('importing')
    w = watchStep(w, { type: 'imported' }, T0 + 30)
    expect(w.state).toBe('done')
    expect(watchStep(w, { type: 'mail', mail }, T0 + 40).state).toBe('done')
  })
  it('goes back to link seen when the import fails, and ignores events out of order', () => {
    let w = watchStep(startWatch(T0), { type: 'mail', mail }, T0)
    expect(watchStep(w, { type: 'imported' }, T0).state).toBe('link_seen')
    w = watchStep(w, { type: 'import' }, T0)
    expect(watchStep(w, { type: 'failed' }, T0).state).toBe('link_seen')
    expect(watchStep(startWatch(T0), { type: 'import' }, T0).state).toBe('waiting')
  })
  it('expires: no mail within 31 days, or the link older than 7 days', () => {
    expect(watchStep(startWatch(T0), { type: 'tick' }, T0 + WAIT_MAX_MS + 1).state).toBe('expired')
    expect(watchStep(startWatch(T0), { type: 'tick' }, T0 + WAIT_MAX_MS - 1).state).toBe('waiting')
    const seen = watchStep(startWatch(T0), { type: 'mail', mail }, T0)
    expect(watchStep(seen, { type: 'import' }, T0 + LINK_TTL_MS + 1).state).toBe('expired')
    expect(watchStep(seen, { type: 'tick' }, T0 + LINK_TTL_MS - 1).state).toBe('link_seen')
  })
})

describe('sovereign import: verify gate', () => {
  it('assigns a download to its service by file name', () => {
    expect(serviceForArchive(SERVICES_RTBF, 'takeout-20261101T100000Z-001.zip')).toBe('google')
    expect(serviceForArchive(SERVICES_RTBF, 'Complete_LinkedInDataExport_11-01-2026.zip')).toBe('linkedin')
    expect(serviceForArchive(SERVICES_RTBF, 'holiday.zip')).toBeNull()
  })
  it('passes with a marker and enough bytes, fails on a missing marker or a tiny file', () => {
    const big = MIN_TOTAL_BYTES + 1
    expect(verifyArchive(svc('google'), ['Takeout/Contacts/All.vcf'], big).passed).toBe(true)
    expect(verifyArchive(svc('google'), ['other/a.txt'], big).passed).toBe(false)
    expect(verifyArchive(svc('google'), ['Takeout/a'], 10).passed).toBe(false)
    expect(verifyArchive(svc('google'), [], big).passed).toBe(false)
  })
  it('loose mode (Amazon) needs only the size', () => {
    expect(verifyArchive(svc('amazon'), [], MIN_TOTAL_BYTES).passed).toBe(true)
    expect(verifyArchive(svc('amazon'), [], 5).passed).toBe(false)
  })
})

describe('sovereign import: page sections', () => {
  it('hides erasure, export and be-forgotten until Advanced is open', () => {
    expect(pageSections(false)).toEqual(['start', 'services', 'watch', 'other', 'sync', 'import', 'advanced'])
    const open = pageSections(true)
    expect(open.slice(0, 7)).toEqual(pageSections(false))
    expect(open.slice(7)).toEqual(['export', 'forget', 'erasure'])
  })
})

describe('sovereign import: search block swap', () => {
  afterEach(() => { SEARCH_CONFIG.adapter = 'builtin' })
  const cands = [{ ring: 'closest', text: 'a' }, { ring: 'friend', text: 'b' }]
  it('uses a registered adapter chosen in the config, and falls back to the built-in one for an unknown id', () => {
    const fake = { id: 'fake', rank: (c) => [...c].reverse().map((person) => ({ person, score: 0.5, terms: { zone: 0, tag: 0, recency: 0, recip: 0, text: 0 } })) }
    registerRankAdapter(fake)
    SEARCH_CONFIG.adapter = 'fake'
    expect(rank(cands, { now: 1 }).map((r) => r.person.text)).toEqual(['b', 'a'])
    SEARCH_CONFIG.adapter = 'missing'
    expect(rank(cands, { now: 1 }).map((r) => r.person.text)).toEqual(['a', 'b'])
  })
})
