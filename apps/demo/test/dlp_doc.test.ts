import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * docs/ops/dlp.md is an operating document, so it is held to a contract: the sections an operator
 * needs at 03:00 must exist, every comparable-SaaS claim carries a source tier, every repo path it
 * names must still exist, and it carries no personal data. If this fails, fix the document (or the
 * path it names), do not loosen the test.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DOC = `${ROOT}docs/ops/dlp.md`
const doc = existsSync(DOC) ? readFileSync(DOC, 'utf8') : ''

const section = (title: RegExp): string => {
  const parts = doc.split(/^## /m).slice(1)
  return parts.find((p) => title.test(p.split('\n', 1)[0] ?? '')) ?? ''
}

describe('docs/ops/dlp.md exists and has the required sections', () => {
  it('exists', () => {
    expect(existsSync(DOC)).toBe(true)
  })
  it.each([
    /^Conclusion/i,
    /Comparable SaaS/i,
    /What we hold and where/i,
    /Targets \(RPO and RTO\)/i,
    /Backup plan/i,
    /Restore drills/i,
    /Open decisions/i,
  ])('has a section matching %s', (re) => {
    expect(section(re)).not.toBe('')
  })
})

describe('comparable SaaS section', () => {
  const saas = section(/Comparable SaaS/i)
  it.each(['Tana', 'Notion', 'Linear', 'Obsidian Sync'])('covers %s with a tiered source and a verification status', (name) => {
    const row = saas.split('\n').find((l) => l.startsWith('|') && l.includes(name)) ?? ''
    expect(row).not.toBe('')
    expect(row).toMatch(/\[[ABC]\]/)
    expect(row).toMatch(/verified|unverified/i)
  })
  it('names the three mechanisms the task asks about', () => {
    for (const word of ['PITR', 'multi-region', 'restore drill']) expect(saas.toLowerCase()).toContain(word.toLowerCase())
  })
  it('flags claims older than ten years or unverified with the warning sign', () => {
    expect(saas).toContain('⚠️')
  })
})

describe('targets and drills', () => {
  it('gives every surface an RPO and an RTO in the targets table', () => {
    const rows = section(/Targets \(RPO and RTO\)/i)
      .split('\n')
      .filter((l) => l.startsWith('|') && !/^\|[\s:-]+\|/.test(l))
      .slice(1)
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const r of rows) expect(r).toMatch(/\d+\s*(min|h|d)/i)
  })
  it('defines cadence, pass criteria, a synthetic-data rule and a drill log template', () => {
    const d = section(/Restore drills/i).toLowerCase()
    for (const w of ['monthly', 'quarterly', 'pass criteria', 'synthetic', 'drill log']) expect(d).toContain(w)
  })
  it('keeps the honesty rules: ciphertext only, nothing claimed that is not built', () => {
    expect(doc).toMatch(/ciphertext/i)
    expect(doc).toMatch(/proposal|not built|not implemented/i)
    expect(doc).toMatch(/I1/)
    expect(doc).toMatch(/I7/)
  })
})

describe('repo hygiene of the document', () => {
  it('every repo path it names in backticks still exists', () => {
    const paths = [...doc.matchAll(/`((?:services|scripts|packages|apps|docs)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]!)
    expect(paths.length).toBeGreaterThan(5)
    const missing = paths.filter((p) => !existsSync(`${ROOT}${p.replace(/\/$/, '')}`))
    expect(missing).toEqual([])
  })
  it('contains no personal data: no e-mail, phone number, 64-hex id or IPv4 address', () => {
    expect(doc).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/)
    expect(doc).not.toMatch(/\+\d[\d ]{7,}/)
    expect(doc).not.toMatch(/\b[0-9a-f]{64}\b/)
    expect(doc).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)
  })
  it('uses a regular hyphen, no em dash', () => {
    expect(doc).not.toContain('—')
  })
})
