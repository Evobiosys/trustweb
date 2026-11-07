// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const tokens = JSON.parse(read('../../src/design/tokens.json'))

describe('no hand-tuned dark forks', () => {
  it('styles.css has no :root:not([data-theme="light"]) rules', () => {
    expect(read('../../src/styles.css')).not.toMatch(/:root:not\(\[data-theme="light"\]\)/)
  })
  it('styles.css has no prefers-color-scheme block of its own (tokens.css owns them)', () => {
    expect(read('../../src/styles.css')).not.toMatch(/prefers-color-scheme/)
  })
  it('demo_install_button.ts has none either', () => {
    const src = read('../../src/demo_install_button.ts')
    expect(src).not.toMatch(/data-theme/)
    expect(src).not.toMatch(/prefers-color-scheme/)
  })
  it('walkthrough.ts and solo.ts read tokens instead of their own dark blocks', () => {
    expect(read('../../src/walkthrough.ts')).not.toMatch(/prefers-color-scheme: dark/)
    expect(read('../../src/solo.ts')).not.toMatch(/prefers-color-scheme: dark/)
  })
  it('solo.ts loads tokens.css (the demo pages do not load styles.css)', () => {
    expect(read('../../src/solo.ts')).toMatch(/design\/tokens\.css/)
  })
  it('every token added for the re-pointing exists in light and dark', () => {
    for (const n of ['start-end', 'reached-ink', 'hit-tint', 'hit-edge', 'hit-mark', 'phone-edge', 'phone-rim',
      'rec-a', 'rec-b', 'rec-paused-a', 'rec-paused-b']) {
      expect(tokens.one.light, n).toHaveProperty(n)
      expect(tokens.one.dark, n).toHaveProperty(n)
    }
  })
})
