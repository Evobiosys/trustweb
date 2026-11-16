// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** @vitest-environment jsdom
 * Wave 44 steer-settings-sync: a search shows only the matching rows, no section headings. */
import { filterSettings } from '../../src/settings_search.ts'

const html = `<div id="root"><div data-settings-group="a"><h4 class="eyebrow">Heading A</h4>
<details data-settings-section="x"><summary>Section X</summary><button id="r1">Backup now</button><button id="r2">Theme dark</button></details></div>
<div data-settings-group="b"><details data-settings-section="sync"><summary>Sync</summary><button id="r3">Keep a copy</button></details></div></div>`

describe('filterSettings rows only', () => {
  it('hides headings, summaries and non-matching rows', () => {
    document.body.innerHTML = html
    const root = document.getElementById('root')
    filterSettings(root, 'backup')
    expect(document.getElementById('r1').hidden).toBe(false)
    expect(document.getElementById('r2').hidden).toBe(true)
    expect(root.querySelector('h4').hidden).toBe(true)
    expect(root.querySelector('summary').hidden).toBe(true)
    expect(root.querySelector('[data-settings-group=b]').hidden).toBe(true)
  })
  it('an empty query shows headings again', () => {
    document.body.innerHTML = html
    const root = document.getElementById('root')
    filterSettings(root, 'backup'); filterSettings(root, '')
    expect(root.querySelector('h4').hidden).toBe(false)
    expect(root.querySelector('summary').hidden).toBe(false)
    expect(document.getElementById('r2').hidden).toBe(false)
  })
  it('a section title match keeps its rows, still without the heading', () => {
    document.body.innerHTML = html
    const root = document.getElementById('root')
    filterSettings(root, 'sync')
    expect(document.getElementById('r3').hidden).toBe(false)
    expect(root.querySelector('[data-settings-section=sync] > summary').hidden).toBe(true)
  })
})
