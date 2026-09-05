import { describe, expect, it } from 'vitest'
import {
  CENTRAL_BUDGET_MS,
  K_FLOOR_DEFAULT,
  type DeclarationFacets,
  evaluateFloor,
  indistinguishableNo,
  protectAsker,
  requiresSoleAuthorAck,
  settleAt,
} from '../src/index'

function facets(overrides: Partial<DeclarationFacets> = {}): DeclarationFacets {
  return {
    category: 'accommodation.sublet',
    regionCode: 'AT-9',
    authorCommitment: 'author-a',
    sensitive: false,
    ...overrides,
  }
}

describe('K_FLOOR_DEFAULT', () => {
  it('is 7, this package\'s own constant', () => {
    expect(K_FLOOR_DEFAULT).toBe(7)
  })
})

describe('evaluateFloor', () => {
  it('counts distinct authors, not records: 7 records from 1 author is below floor', () => {
    const candidates = Array.from({ length: 7 }, () => facets({ authorCommitment: 'author-a' }))
    const verdict = evaluateFloor({ candidates })
    expect(verdict).toEqual({ kind: 'below', distinctAuthors: 1 })
  })

  it('is above floor once distinct authors reach K_FLOOR_DEFAULT', () => {
    const candidates = Array.from({ length: K_FLOOR_DEFAULT }, (_, i) =>
      facets({ authorCommitment: `author-${i}` }),
    )
    const verdict = evaluateFloor({ candidates })
    expect(verdict).toEqual({ kind: 'above', distinctAuthors: K_FLOOR_DEFAULT })
  })

  it('is below floor at K_FLOOR_DEFAULT - 1 distinct authors', () => {
    const candidates = Array.from({ length: K_FLOOR_DEFAULT - 1 }, (_, i) =>
      facets({ authorCommitment: `author-${i}` }),
    )
    const verdict = evaluateFloor({ candidates })
    expect(verdict).toEqual({ kind: 'below', distinctAuthors: K_FLOOR_DEFAULT - 1 })
  })

  it('respects a supplied kFloor override', () => {
    const candidates = [facets({ authorCommitment: 'a' }), facets({ authorCommitment: 'b' })]
    expect(evaluateFloor({ candidates, kFloor: 2 })).toEqual({ kind: 'above', distinctAuthors: 2 })
    expect(evaluateFloor({ candidates, kFloor: 3 })).toEqual({ kind: 'below', distinctAuthors: 2 })
  })

  it('duplicate records from the same author do not inflate distinctAuthors', () => {
    const candidates = [
      facets({ authorCommitment: 'a' }),
      facets({ authorCommitment: 'a' }),
      facets({ authorCommitment: 'b' }),
    ]
    expect(evaluateFloor({ candidates, kFloor: 2 })).toEqual({ kind: 'above', distinctAuthors: 2 })
  })
})

describe('requiresSoleAuthorAck', () => {
  it('is true for a facet set with one possible author (empty corpus)', () => {
    expect(requiresSoleAuthorAck(facets({ authorCommitment: 'a' }), [])).toBe(true)
  })

  it('is true when every corpus record sharing the facet pair is the same author', () => {
    const corpus = [
      facets({ authorCommitment: 'a' }),
      facets({ authorCommitment: 'a' }),
    ]
    expect(requiresSoleAuthorAck(facets({ authorCommitment: 'a' }), corpus)).toBe(true)
  })

  it('is false once a second distinct author shares the same facet pair', () => {
    const corpus = [facets({ authorCommitment: 'b' })]
    expect(requiresSoleAuthorAck(facets({ authorCommitment: 'a' }), corpus)).toBe(false)
  })

  it('ignores corpus records outside the (category, regionCode) pair', () => {
    const corpus = [
      facets({ authorCommitment: 'b', category: 'other.category' }),
      facets({ authorCommitment: 'c', regionCode: 'AT-1' }),
    ]
    expect(requiresSoleAuthorAck(facets({ authorCommitment: 'a' }), corpus)).toBe(true)
  })
})

describe('protectAsker', () => {
  it('removes askerDid and askerLabel when sensitive', () => {
    const payload = { askerDid: 'did:1', askerLabel: 'Jakob', other: 'kept' }
    const result = protectAsker(payload, true)
    expect(result).not.toHaveProperty('askerDid')
    expect(result).not.toHaveProperty('askerLabel')
    expect(result.other).toBe('kept')
  })

  it('leaves askerDid and askerLabel when not sensitive', () => {
    const payload = { askerDid: 'did:1', askerLabel: 'Jakob', other: 'kept' }
    const result = protectAsker(payload, false)
    expect(result).toEqual(payload)
  })

  it('does not mutate the input', () => {
    const payload = { askerDid: 'did:1', askerLabel: 'Jakob' }
    const frozen = Object.freeze({ ...payload })
    expect(() => protectAsker(frozen, true)).not.toThrow()
    expect(frozen).toEqual(payload)
  })

  it('returns a new object, not the same reference, when not sensitive', () => {
    const payload = { askerDid: 'did:1' }
    const result = protectAsker(payload, false)
    expect(result).not.toBe(payload)
  })
})

describe('indistinguishableNo', () => {
  it('is byte-identical across independent call sites (below-k, declined, no-match)', () => {
    const belowK = indistinguishableNo()
    const declined = indistinguishableNo()
    const noMatch = indistinguishableNo()
    expect(Buffer.from(declined)).toEqual(Buffer.from(belowK))
    expect(Buffer.from(noMatch)).toEqual(Buffer.from(belowK))
    expect(declined.length).toBe(belowK.length)
    expect(noMatch.length).toBe(belowK.length)
  })

  it('returns a fresh copy each call: mutating one does not affect the next', () => {
    const first = indistinguishableNo()
    first[0] = first[0] ^ 0xff
    const second = indistinguishableNo()
    expect(Buffer.from(second)).toEqual(Buffer.from(indistinguishableNo()))
    expect(second[0]).not.toBe(first[0])
  })
})

describe('settleAt', () => {
  it('resolves no earlier than the budget for a fast inner path', async () => {
    const budgetMs = 60
    const t0 = Date.now()
    await settleAt(t0, budgetMs)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(budgetMs - 5)
  })

  it('resolves no earlier than the budget for a slow inner path that already overran it', async () => {
    const budgetMs = 30
    const t0 = Date.now()
    await new Promise((resolve) => setTimeout(resolve, budgetMs + 20))
    const before = Date.now()
    await settleAt(t0, budgetMs)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(budgetMs)
    // Already overran the budget: settleAt must not add extra delay.
    expect(Date.now() - before).toBeLessThan(15)
  })
})

describe('CENTRAL_BUDGET_MS', () => {
  it('is 900', () => {
    expect(CENTRAL_BUDGET_MS).toBe(900)
  })
})
