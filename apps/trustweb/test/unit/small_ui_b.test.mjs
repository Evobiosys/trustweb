// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 small-ui-b: AI Test tolerance, custom presets, view list, own-data rule, looks (Default / Sleek / Dex-like), export-mail paste. */
import { describe, expect, it } from 'vitest'
import { parseReply, testEndpoint, testResultLines, CUSTOM_PRESETS, customPreset, customPresetOf } from '../../src/llm_endpoint.ts'
import { SETTINGS_VIEWS, UiView } from '../../src/desktop_view.ts'
import { ownDataImported } from '../../src/own_data.ts'
import { LOOKS, LOOK_KEY, readLook, applyLook, SLEEK_TOKENS, DEX_TOKENS } from '../../src/look.ts'
import { parseExportMail, pastedMail, pasteTarget } from '../../src/export_mail.ts'
import { headerControls, headerPins, HEADER_PINS } from '../../src/header_controls.ts'
import { S } from '../../src/strings.ts'

const ai = { preset: 'custom', baseUrl: 'http://x/v1', apiKey: '', model: 'm' }
const reply = (content) => ({ choices: [{ message: { content } }] })
const fake = (ok, status, body) => async () => ({ ok, status, json: async () => body })

describe('AI test: "not JSON" no longer fails a working endpoint', () => {
  it('parseReply drops <think> blocks and finds the JSON inside prose', () => {
    expect(parseReply(reply('<think>hmm {x}</think>\n{"a":1}'))).toEqual({ a: 1 })
    expect(parseReply(reply('Sure! Here it is: {"a":1} Hope that helps.'))).toEqual({ a: 1 })
  })
  it('parseReply keeps null for text without JSON', () => expect(parseReply(reply('Hello'))).toBeNull())
  it('a plain-text answer is a working connection with a note, not a failure', async () => {
    const o = await testEndpoint(ai, fake(true, 200, reply('Hello')))
    expect(o).toMatchObject({ ok: true, reply: 'Hello', note: 'not JSON' })
    const lines = testResultLines(o)
    expect(lines[0]).toMatchObject({ kind: 'status', ok: true })
    expect(lines.at(-1)).toMatchObject({ kind: 'hint', text: S.aiTestHintJson })
  })
  it('a body that is a web page (not an AI endpoint) still fails, with the address hint', async () => {
    const html = async () => ({ ok: true, status: 200, json: async () => { throw new Error('x') }, text: async () => '<html>app</html>' })
    const o = await testEndpoint(ai, html)
    expect(o).toMatchObject({ ok: false, message: 'not JSON', raw: '<html>app</html>' })
    expect(testResultLines(o).at(-1).text).toBe(S.aiTestHintPage)
  })
})

describe('Custom presets (pc24 sits inside Custom)', () => {
  it('offers Ollama on this device, pc24 and Other, never OpenAI', () => {
    expect(CUSTOM_PRESETS.map((p) => p.id)).toEqual(['ollama', 'pc24', 'other'])
  })
  it('a preset becomes a custom endpoint with its name, URL and model, and no key', () => {
    const out = customPreset({ ...ai, apiKey: 'secret', preset: 'custom' }, 'pc24')
    expect(out).toMatchObject({ preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', model: 'qwen3.6:35b', apiKey: '' })
  })
  it('shows an endpoint as the preset it came from; old own-key presets read as Custom', () => {
    expect(customPresetOf({ ...ai, name: 'pc24' })).toBe('pc24')
    expect(customPresetOf({ ...ai, preset: 'ollama', baseUrl: 'http://localhost:11434/v1' })).toBe('ollama')
    expect(customPresetOf({ ...ai, baseUrl: 'http://localhost:11434/v1/' })).toBe('ollama')
    expect(customPresetOf({ ...ai, preset: 'openai', baseUrl: 'https://api.openai.com/v1' })).toBe('other')
  })
  it('Other keeps no name and an empty address', () => expect(customPreset(ai, 'other')).toMatchObject({ preset: 'custom', baseUrl: '', model: '' }))
})

describe('the Settings view list', () => {
  it('offers only Dex and TrustWeb', () => expect(SETTINGS_VIEWS).toEqual([UiView.Dex, UiView.TrustWeb]))
})

describe('ownDataImported: more own people than the demo seed', () => {
  const people = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}` }))
  it('false for a record that is only the seed', () => expect(ownDataImported(people(10), new Set(people(10).map((p) => p.id)), 10)).toBe(false))
  it('false at exactly the seed size, true above it', () => {
    expect(ownDataImported(people(10), new Set(), 10)).toBe(false)
    expect(ownDataImported(people(11), new Set(), 10)).toBe(true)
  })
  it('demo people do not count', () => expect(ownDataImported(people(30), new Set(people(25).map((p) => p.id)), 10)).toBe(false))
})

describe('looks: Default, Sleek, Dex-like', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
  it('has the three looks, Default first', () => expect(LOOKS).toEqual(['default', 'sleek', 'dex']))
  it('reads Default for nothing or junk', () => {
    expect(readLook(mem())).toBe('default')
    const s = mem(); s.setItem(LOOK_KEY, 'neon'); expect(readLook(s)).toBe('default')
    expect(readLook({ getItem: () => { throw new Error('x') } })).toBe('default')
  })
  it('stores and applies a look; Default clears the attribute', () => {
    const s = mem(); const attrs = {}
    const root = { setAttribute: (k, v) => { attrs[k] = v }, removeAttribute: (k) => { delete attrs[k] } }
    applyLook('sleek', root, s); expect(attrs['data-look']).toBe('sleek'); expect(readLook(s)).toBe('sleek')
    applyLook('default', root, s); expect(attrs['data-look']).toBeUndefined(); expect(readLook(s)).toBe('default')
  })
  it('Sleek is dense: 13 px UI font, tighter spacing, 1 px lines', () => {
    expect(SLEEK_TOKENS.light['--fs-2']).toBe('13px')
    expect(parseInt(SLEEK_TOKENS.light['--s-4'])).toBeLessThan(16)
    expect(SLEEK_TOKENS.light['--hairline']).toBe('1px')
  })
  it('overlay keys are real design tokens', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../../src/design/tokens.css', import.meta.url), 'utf8')
    for (const t of [SLEEK_TOKENS, DEX_TOKENS]) for (const mode of ['light', 'dark']) for (const k of Object.keys(t[mode])) if (k !== '--hairline') expect(css, k).toContain(`${k}:`)
  })
  it('ink on surface keeps AA (4.5:1) in every look and mode', async () => {
    const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    for (const t of [SLEEK_TOKENS, DEX_TOKENS]) for (const m of ['light', 'dark']) {
      const v = t[m]
      for (const surface of ['--surface-0', '--surface-1', '--raised']) { expect(ratio(v['--ink'], v[surface]), `${m} ink/${surface}`).toBeGreaterThanOrEqual(4.5); expect(ratio(v['--ink-2'], v[surface]), `${m} ink-2/${surface}`).toBeGreaterThanOrEqual(4.5) }
      if (v['--trust-strong']) expect(ratio(v['--trust-strong'], v['--raised']), `${m} trust-strong`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('boot block sets the stored look before first paint', async () => {
  const { readFileSync } = await import('node:fs')
  const vm = await import('node:vm')
  const src = readFileSync(new URL('../../src/design/boot_theme.inline.js', import.meta.url), 'utf8')
  const run = (stored) => { const root = { dataset: {} }; vm.runInNewContext(src, { document: { documentElement: root }, localStorage: { getItem: (k) => (k === LOOK_KEY ? stored : null) }, navigator: {}, matchMedia: () => ({ matches: false }) }); return root.dataset.look }
  it('sleek and dex pass through', () => { expect(run('sleek')).toBe('sleek'); expect(run('dex')).toBe('dex') })
  it('nothing or junk leaves the default (no attribute)', () => { expect(run(null)).toBeUndefined(); expect(run('neon')).toBeUndefined() })
})

describe('export mail: paste a mail, TrustWeb reads sender, subject and link only', () => {
  const raw = 'From: Google <noreply@accounts.google.com>\nSubject: Your Google data export is ready\n\nHi Anna, your secret body text.\nDownload: https://takeout.google.com/manage/archive/abc?x=1 and more'
  it('takes From, Subject and the first https link, never the body', () => {
    expect(parseExportMail(raw)).toEqual({ from: 'noreply@accounts.google.com', subject: 'Your Google data export is ready', url: 'https://takeout.google.com/manage/archive/abc?x=1' })
  })
  it('a bare link counts as the link', () => expect(parseExportMail('https://example.org/dl').url).toBe('https://example.org/dl'))
  it('matches the service by sender domain and subject (pastedMail)', () => {
    expect(pastedMail({ mailFrom: ['google.com'] }, raw)).toMatchObject({ url: 'https://takeout.google.com/manage/archive/abc?x=1' })
    expect(pastedMail({ mailFrom: ['facebookmail.com'] }, raw)).toBeNull()
  })
  it('without a link there is nothing to carry on with', () => expect(pastedMail({ mailFrom: ['google.com'] }, 'From: a@google.com\nSubject: export ready\n\nhello')).toBeNull())
})

describe('pasteTarget: which service the pasted mail is for', () => {
  const raw = 'From: noreply@accounts.google.com\nSubject: Your export is ready\n\nhttps://takeout.google.com/x'
  const svcs = [{ id: 'facebook', mailFrom: ['facebookmail.com'] }, { id: 'google', mailFrom: ['google.com'] }]
  it('finds the service by sender domain', () => expect(pasteTarget(svcs, raw, undefined)).toMatchObject({ id: 'google' }))
  it('skips a service whose link was seen already', () => expect(pasteTarget(svcs, raw, { google: { state: 'link_seen', startedAt: 1 } })).toBeNull())
  it('takes an expired one again', () => expect(pasteTarget(svcs, raw, { google: { state: 'expired', startedAt: 1 } })).toMatchObject({ id: 'google' }))
  it('nothing for a mail of nobody we wait for', () => expect(pasteTarget(svcs, 'From: a@b.org\nSubject: export\nhttps://b.org/x', undefined)).toBeNull())
})

describe('header: AI sits at the far right; the select tool is no pin (wave 40: it is a Tools row)', () => {
  it('headerControls no longer lists the AI inside search (it is mounted last on every view)', () => expect(headerControls('web')).not.toContain('ai'))
  it('the select tool is not a header pin; the default is none and a stored list wins', () => {
    expect(HEADER_PINS).not.toContain('select')
    expect(headerPins(undefined)).toEqual([])
    expect(headerPins(['select'])).toEqual([])
  })
})

describe('favicon: the TrustWeb mark on every TrustWeb page', () => {
  it('every html entry carries the same mark as index.html, never the old purple disc', async () => {
    const { readFileSync } = await import('node:fs')
    const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
    const mark = read('index.html').match(/<link rel="icon"[^>]*>/)[0]
    for (const p of ['index.html', 'solo.html', 'organizer.html', 'styleguide.html', 'demo/index.html', 'ea-demo/index.html', 'emergent-demo/index.html']) {
      const html = read(p)
      expect(html, p).toContain(mark)
      expect(html, p).not.toContain('%239A37F0')
    }
  })
})

describe('looks.css repeats the token tables of look.ts', () => {
  it('every declaration of Sleek and Dex-like, light and dark, is in looks.css', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../../src/design/looks.css', import.meta.url), 'utf8')
    const block = (sel) => { const i = css.indexOf(sel + '{'); return css.slice(i, css.indexOf('}', i)) }
    for (const [name, t] of [['sleek', SLEEK_TOKENS], ['dex', DEX_TOKENS]]) {
      const light = block(`:root[data-look="${name}"]`)
      const dark = block(`:root[data-look="${name}"][data-theme="dark"]`)
      for (const [k, v] of Object.entries(t.light)) expect(light, `${name} light ${k}`).toContain(`${k}:${v};`)
      for (const [k, v] of Object.entries(t.dark)) expect(dark, `${name} dark ${k}`).toContain(`${k}:${v};`)
      expect(css).toContain(`:root[data-look="${name}"]:not([data-theme="light"]):not([data-theme="dark"])`)
    }
  })
})

describe('install wording', () => {
  it('the install card and its Settings button say "on this device"', () => {
    expect(S.instTitle).toBe('Install TrustWeb on this device')
    expect(S.setInstall).toBe('Install TrustWeb on this device')
  })
  it('the export-mail heading names the alpha label', () => expect(S.alphaLabel).toBe('untested alpha feature'))
})
