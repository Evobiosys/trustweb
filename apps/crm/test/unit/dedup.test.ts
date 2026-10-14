import { describe, expect, it } from 'vitest'
import { findDuplicates, MatchReason, mergeContacts, normalizeName, normalizePhone } from '../../src/import/dedup'
import { ContactSource, type ImportedContact } from '../../src/import/types'

function c(name: string, extra: Partial<ImportedContact> = {}): ImportedContact {
  return { source: ContactSource.VCard, file: 'a.vcf', sourceRef: name, name, phones: [], emails: [], labels: [], ...extra }
}

describe('normalizePhone', () => {
  it('treats the Austrian spellings as one number', () => {
    const want = '+436605551234'
    for (const raw of ['0660 5551234', '+43 660 5551234', '0043660 5551234', '+43 (0) 660 5551234', '0660/555-1234'])
      expect(normalizePhone(raw)).toBe(want)
  })
  it('uses the default country and rejects short numbers', () => {
    expect(normalizePhone('0170 5551234', '49')).toBe('+491705551234')
    expect(normalizePhone('12345')).toBe('')
    expect(normalizePhone('')).toBe('')
  })
})

describe('normalizeName', () => {
  it('folds case, diacritics, punctuation and token order', () => {
    expect(normalizeName('Huber, Maria')).toBe(normalizeName('Maria Huber'))
    expect(normalizeName('Jörg Strauß')).toBe('jorg strauss')
    expect(normalizeName('  Äpfel-Müller,  Åse ')).toBe('apfel ase muller')
  })
})

describe('findDuplicates', () => {
  it('links by email (case-insensitive), sure', () => {
    const g = findDuplicates([c('Maria Huber', { emails: ['maria@example.at'] }), c('M. H.', { emails: ['Maria@Example.at'] })])
    expect(g).toEqual([{ members: [0, 1], reasons: [MatchReason.Email], sure: true }])
  })
  it('links by phone across spellings, sure', () => {
    const g = findDuplicates([c('Ben Gruber', { phones: ['0660 5551234'] }), c('Benedikt G', { phones: ['+43 660 5551234'] })])
    expect(g).toEqual([{ members: [0, 1], reasons: [MatchReason.Phone], sure: true }])
  })
  it('links the same name in any order, not sure', () => {
    const g = findDuplicates([c('Huber, Maria'), c('Maria Huber')])
    expect(g).toEqual([{ members: [0, 1], reasons: [MatchReason.SameName], sure: false }])
  })
  it('links similar names, not sure', () => {
    const g = findDuplicates([c('Maria Huber'), c('Maria Hubner')])
    expect(g).toEqual([{ members: [0, 1], reasons: [MatchReason.SimilarName], sure: false }])
  })
  it('never links a single-token name alone', () => {
    expect(findDuplicates([c('Maria'), c('Maria'), c('Maria Huber')])).toEqual([])
  })
  it('joins transitively and a name link makes the group not sure', () => {
    const list = [
      c('A One', { emails: ['x@example.com'] }),
      c('B Two', { emails: ['x@example.com'], phones: ['0660 5551111'] }),
      c('C Three', { phones: ['+43 660 5551111'] }),
      c('D Four'),
      c('Four D'),
    ]
    const g = findDuplicates(list)
    expect(g).toHaveLength(2)
    expect(g[0]).toMatchObject({ members: [0, 1, 2], sure: true })
    expect(g[1]).toMatchObject({ members: [3, 4], sure: false })
  })
  it('stays sure when a name link is redundant', () => {
    const g = findDuplicates([c('Maria Huber', { emails: ['m@example.at'] }), c('Huber Maria', { emails: ['m@example.at'] })])
    expect(g[0].sure).toBe(true)
  })
  it('is not sure when a name link joins two sure groups', () => {
    const g = findDuplicates([
      c('Maria Huber', { emails: ['a@example.at'] }),
      c('Maria Huber', { emails: ['b@example.at'] }),
      c('X', { emails: ['a@example.at'] }),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].members).toEqual([0, 1, 2])
    expect(g[0].sure).toBe(false)
  })
  it('handles 5000 contacts under 1 s', () => {
    const given = ['Maria', 'Anna', 'Lukas', 'Jonas', 'Sophie', 'Felix', 'Laura', 'Paul', 'Eva', 'Max']
    const family = ['Huber', 'Gruber', 'Bauer', 'Wagner', 'Pichler', 'Moser', 'Mayer', 'Hofer', 'Leitner', 'Berger']
    const list = Array.from({ length: 5000 }, (_, i) =>
      c(`${given[i % 10]} ${family[Math.floor(i / 10) % 10]}${i}`, { emails: [`p${i}@example.at`] }),
    )
    const t = Date.now()
    findDuplicates(list)
    expect(Date.now() - t).toBeLessThan(1000)
  })
})

describe('mergeContacts', () => {
  it('unions and picks per the rules', () => {
    const m = mergeContacts([
      c('Maria H', { phones: ['0660 5551234'], emails: ['a@example.at'], labels: ['family'], note: 'one', since: 200, org: '' }),
      c('Maria Huber', {
        source: ContactSource.GoogleCsv,
        phones: ['+43 660 5551234', '0660 5559999'],
        emails: ['a@example.at', 'b@example.at'],
        labels: ['family', 'work'],
        note: 'one',
        org: 'Bakery',
        birthday: '1980-02-03',
        since: 100,
      }),
      c('Maria Hu', { note: 'two' }),
    ])
    expect(m.name).toBe('Maria Huber')
    expect(m.source).toBe(ContactSource.VCard)
    expect(m.phones).toEqual(['0660 5551234', '0660 5559999'])
    expect(m.emails).toEqual(['a@example.at', 'b@example.at'])
    expect(m.labels).toEqual(['family', 'work'])
    expect(m.note).toBe('one\n\ntwo')
    expect(m.org).toBe('Bakery')
    expect(m.birthday).toBe('1980-02-03')
    expect(m.since).toBe(100)
  })
})
