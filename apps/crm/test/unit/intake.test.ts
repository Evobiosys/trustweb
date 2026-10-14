import { describe, expect, it } from 'vitest'
import { detectFormat, parseFile } from '../../src/import/detect'
import { apply, decisionFor, plan } from '../../src/import/intake'
import type { FileInput } from '../../src/import/intake'
import { ContactSource } from '../../src/import/types'
import { emptyCrm, isCrmState } from '../../src/model'
import type { Contact } from '../../src/model'

const files = import.meta.glob<string>('../fixtures/contacts/**/*', { query: '?raw', import: 'default', eager: true })
const read = (name: string): string => files[`../fixtures/contacts/${name}`]
const demo = (name: string): FileInput => ({ name, text: read(`demo_folder/${name}`) })
const DEMO = ['contacts.vcf', 'contacts.csv', 'your_friends.json'].map(demo)
const counter = (): (() => string) => { let n = 0; return () => `local:t${++n}` }
const names = (list: Contact[]): string[] => list.map((c) => c.name)

describe('detectFormat', () => {
  it('goes by content, not by name', () => {
    expect(detectFormat('x.txt', read('v40.vcf'))).toBe(ContactSource.VCard)
    expect(detectFormat('x.vcf', read('google_current.csv'))).toBe(ContactSource.GoogleCsv)
    expect(detectFormat('x.csv', read('fb_your_friends.json'))).toBe(ContactSource.FacebookJson)
    expect(detectFormat('x.vcf', '\uFEFF  \n BEGIN:VCARD\nEND:VCARD')).toBe(ContactSource.VCard)
  })

  it('returns null for anything else, never throws', () => {
    for (const text of ['', 'hello', '{"a":1}', '{broken', read('not_google.csv'), 'a,b\n1,2']) {
      expect(detectFormat('f', text)).toBeNull()
    }
    expect(parseFile('photo.jpg', 'plain text')).toEqual({ format: null, result: { contacts: [], skipped: 0 } })
  })

  it('parseFile uses the matching parser and the file name', () => {
    const { format, result } = parseFile('mine.dat', read('fb_your_friends.json'))
    expect(format).toBe(ContactSource.FacebookJson)
    expect(result.contacts.every((c) => c.file === 'mine.dat')).toBe(true)
  })
})

describe('plan and apply', () => {
  it('summarises the demo folder and groups its duplicates', () => {
    const p = plan([], DEMO)
    expect(p.files.map((f) => [f.name, f.count, f.skipped])).toEqual([['contacts.vcf', 7, 0], ['contacts.csv', 6, 1], ['your_friends.json', 5, 0]])
    expect(p.fresh).toHaveLength(18)
    expect(p.alreadyHere).toBe(0)
    expect(p.groups.filter((g) => g.sure).map((g) => g.members.length).sort()).toEqual([2, 2, 2, 3])
    expect(p.groups.filter((g) => !g.sure)).toHaveLength(2)
    const out = apply([], p, {}, counter())
    expect(out).toHaveLength(18 - 1 - 1 - 1 - 2)
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length)
    const dan = out.find((c) => c.name.includes('Daniel'))!
    expect(dan.sources).toHaveLength(3)
    expect(dan.phones).toHaveLength(1)
  })

  it('merges an unsure group only when told "same"', () => {
    const p = plan([], DEMO)
    const gi = p.groups.findIndex((g) => !g.sure)
    expect(decisionFor(p, {}, gi)).toBe('different')
    expect(apply([], p, { [gi]: 'same' }, counter())).toHaveLength(apply([], p, {}, counter()).length - 1)
  })

  it('lets a sure group be split', () => {
    const p = plan([], DEMO)
    const gi = p.groups.findIndex((g) => g.sure && g.members.length === 2)
    expect(apply([], p, { [gi]: 'different' }, counter())).toHaveLength(apply([], p, {}, counter()).length + 1)
  })

  it('is idempotent: the same files again add nothing', () => {
    const first = apply([], plan([], DEMO), {}, counter())
    const again = plan(first, DEMO)
    expect(again.fresh).toHaveLength(0)
    expect(again.alreadyHere).toBe(18)
    expect(again.groups).toHaveLength(0)
    expect(apply(first, again, {}, counter())).toEqual(first)
  })

  it('merges new contacts into a stored one and keeps its id', () => {
    const stored = apply([], plan([], [demo('contacts.vcf')]), {}, counter())
    const anna = stored.find((c) => c.name === 'Anna Gruber')!
    const p = plan(stored, [demo('contacts.csv')])
    expect(p.alreadyHere).toBe(0)
    const out = apply(stored, p, {}, counter())
    const merged = out.find((c) => c.id === anna.id)!
    expect(merged.sources.map((s) => s.file).sort()).toEqual(['contacts.csv', 'contacts.vcf'])
    expect(merged.org).toBe('Alpenbau GmbH')
    expect(out.map((c) => c.id).slice(0, stored.length)).toEqual(stored.map((c) => c.id))
    expect(names(out).filter((n) => n === 'Anna Gruber')).toHaveLength(1)
  })

  it('does not re-ask about two stored contacts already kept apart', () => {
    const a = apply([], plan([], [demo('contacts.vcf')]), {}, counter())
    const withTwin: Contact[] = [...a, { ...a[0], id: 'local:twin' }]
    expect(plan(withTwin, []).groups).toHaveLength(0)
  })
})

describe('CrmState with contacts', () => {
  it('loads a record saved without contacts, and one with them', () => {
    const old = JSON.parse(JSON.stringify(emptyCrm())) as unknown
    expect(isCrmState(old)).toBe(true)
    expect((old as { contacts?: unknown }).contacts).toBeUndefined()
    const contacts = apply([], plan([], DEMO), {}, counter())
    const now = { ...emptyCrm(), contacts, lastImport: { at: 1, files: ['contacts.vcf'], added: contacts.length, before: [] } }
    expect(isCrmState(JSON.parse(JSON.stringify(now)))).toBe(true)
  })
})
