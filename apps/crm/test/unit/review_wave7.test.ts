import { describe, expect, it } from 'vitest'
import { apply, plan } from '../../src/import/intake'
import type { FileInput } from '../../src/import/intake'
import type { Contact } from '../../src/model'

const counter = (): (() => string) => { let n = 0; return () => `local:r${++n}` }
const HEAD = 'First Name,Last Name,E-mail 1 - Value,Phone 1 - Value'
const csv = (...rows: string[]): FileInput => ({ name: 'contacts.csv', text: [HEAD, ...rows].join('\n') })

describe('review wave 7', () => {
  it('a newer export with shifted rows still brings in the new person', () => {
    const stored = apply([], plan([], [csv('Anna,Gruber,anna@example.at,')]), {}, counter())
    const p = plan(stored, [csv('Bernd,Huber,,+43 660 5550103', 'Anna,Gruber,anna@example.at,')])
    expect(p.fresh.map((c) => c.name)).toEqual(['Bernd Huber'])
    expect(p.alreadyHere).toBe(1)
  })

  it('a new contact linked only to a stored twin is not sure-merged into the other stored contact', () => {
    // two stored people kept apart although they share a landline
    const a = apply([], plan([], [csv('Anna,Gruber,anna@example.at,+43 1 5550100')]), {}, counter())
    const b = apply([], plan([], [{ name: 'b.csv', text: `${HEAD}\nMax,Gruber,max@example.at,+43 1 5550100` }]), {}, counter())
    const stored: Contact[] = [...a, { ...b[0], id: 'local:max' }]
    const p = plan(stored, [{ name: 'c.csv', text: `${HEAD}\nMaximilian,Gruber,max@example.at,` }])
    const out = apply(stored, p, {}, counter())
    expect(out.find((c) => c.id === a[0].id)!.emails).toEqual(['anna@example.at'])
    expect(out.find((c) => c.id === 'local:max')!.emails).toEqual(['max@example.at'])
  })

  it('3,000 contacts go through plan() and apply() in under 2 s', () => {
    const first = ['Anna', 'Bernd', 'Clara', 'Daniel', 'Eva', 'Franz', 'Gerda', 'Hannes', 'Ines', 'Josef']
    let seed = 7
    const rnd = (n: number): number => { seed = (seed * 48271) % 2147483647; return seed % n }
    const surnames = Array.from({ length: 3000 }, () => {
      const len = 5 + rnd(4)
      const w = Array.from({ length: len }, (_, k) => (k % 2 ? 'aeiou' : 'bdfghklmnprstwz')[rnd(k % 2 ? 5 : 15)]).join('')
      return w[0].toUpperCase() + w.slice(1)
    })
    const family = (i: number): string => surnames[i]
    // every 30th person appears twice with the same mail: 100 sure groups
    const rows = Array.from({ length: 3000 }, (_, i) => {
      const k = i % 30 === 29 ? i - 1 : i
      return `${first[k % 10]},${family(k)},p${k}@example.at,+43 660 555${String(i).padStart(4, '0')}`
    })
    const t = performance.now()
    const p = plan([], [csv(...rows)])
    const out = apply([], p, {}, counter())
    expect(performance.now() - t).toBeLessThan(2000)
    expect(p.fresh).toHaveLength(3000)
    // a few sure pairs pick up a similar-sounding stranger and go to review; none chains into a big card
    expect(p.groups.filter((g) => g.sure).length).toBeGreaterThanOrEqual(90)
    expect(Math.max(...p.groups.map((g) => g.members.length))).toBeLessThanOrEqual(4)
    expect(out).toHaveLength(3000 - p.groups.filter((g) => g.sure).length)
  })
})

describe('similar names', () => {
  it('do not chain into one review card', () => {
    const p = plan([], [csv('Maria,Maier,,', 'Maria,Mayer,,', 'Maria,Meier,,', 'Maria,Meyer,,', 'Maria,Mayr,,')])
    expect(Math.max(...p.groups.map((g) => g.members.length))).toBe(2)
  })
})
