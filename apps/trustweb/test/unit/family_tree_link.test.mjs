/** A connect link may carry a family tree to see (src/family_tree_link.ts): #tree=<id>&k=<key>[&family=1], built and read client-side only. */
import { applyFamily, parseTreeFragment, treeUrl, TREE_PAGE } from '../../src/family_tree_link.ts'
import { CLOSENESS_KEY, Ring } from '../../src/model.ts'

const ID = 'abcdefghijklmnopqrst'
const KEY = 'ABCD-EFGH-2345-6723-4567-ABCD-EF'

describe('parseTreeFragment', () => {
  it('reads id, key and the family flag from the fragment', () => {
    expect(parseTreeFragment(`#tree=${ID}&k=${KEY}&family=1`)).toEqual({ id: ID, key: KEY, family: true })
    expect(parseTreeFragment(`tree=${ID}&k=${KEY}`)).toEqual({ id: ID, key: KEY, family: false })
  })
  it('sits beside the other connect fragment parts (via, n, demo)', () => {
    expect(parseTreeFragment(`#via=SIGNAL&tree=${ID}&k=${KEY}&n=x`)?.id).toBe(ID)
  })
  it('refuses anything that is not a share id and key (never builds a url from it)', () => {
    for (const bad of ['', '#', `#tree=${ID}`, `#k=${KEY}`, `#tree=short&k=${KEY}`, `#tree=../../etc/passwdxxxxx&k=${KEY}`, `#tree=${ID}&k=`, `#tree=${ID}&k=a b`, `#tree=${ID.toUpperCase()}&k=${KEY}`])
      expect(parseTreeFragment(bad), bad).toBeNull()
  })
  it('family is only the literal 1', () => {
    expect(parseTreeFragment(`#tree=${ID}&k=${KEY}&family=yes`)?.family).toBe(false)
  })
})

describe('treeUrl', () => {
  it('opens the Stammbaum page with the key in its fragment, never in the query', () => {
    const u = treeUrl({ id: ID, key: KEY, family: true })
    expect(u).toBe(`${TREE_PAGE}#teilen=${ID}&k=${KEY}`)
    expect(u.split('#')[0]).not.toContain(KEY)
    expect(TREE_PAGE).toBe('https://evobiosys.org/stammbaum/')
  })
})

describe('applyFamily', () => {
  it('puts the contact on the family ring and keeps the chosen closeness', () => {
    const p = { ring: Ring.Friend, fields: undefined }
    applyFamily(p)
    expect(p.ring).toBe(Ring.Family)
    expect(p.fields[CLOSENESS_KEY]).toBe(Ring.Friend)
  })
  it('an intending or already-family contact keeps close as the closeness', () => {
    const a = { ring: Ring.Intending }
    applyFamily(a)
    expect(a.ring).toBe(Ring.Family)
    expect(a.fields[CLOSENESS_KEY]).toBe(Ring.Intending)
    const b = { ring: Ring.Family, fields: { [CLOSENESS_KEY]: Ring.Close } }
    applyFamily(b)
    expect(b.fields[CLOSENESS_KEY]).toBe(Ring.Close)
  })
})
