// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b phone-preview-extension: the "Preview" pill and its bottom sheet (rows, loaded state, like / needs work, note). */
import { noteText, type PreviewFeature } from '../../dev_preview_rules'
import { S } from '../../strings'
import { phonePress, phoneRows, postVerdict, type PhoneRow } from './preview_phone'
import css from './preview_phone.css?inline'

interface Seed { id: string; features: PreviewFeature[] }
interface Deps { fetchFn: Parameters<typeof postVerdict>[0]; copy: (text: string) => Promise<void> }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}

export function mountPreviewPhone(seed: Seed, deps: Deps): void {
  let features = seed.features
  const T = S.previewPhone
  document.head.appendChild(h('style', { textContent: css }))
  document.documentElement.classList.add('twpp-on')   // the Mac panel steps aside on a phone (preview_phone.css)
  const pill = h('button', { className: 'twpp-pill', type: 'button', textContent: T.pill })
  const list = h('div', { className: 'twpp-list' })
  const msg = h('p', { className: 'twpp-msg', hidden: true })
  const close = h('button', { className: 'twpp-x', type: 'button', textContent: T.close })
  const sheet = h('section', { className: 'twpp-sheet', hidden: true }, h('header', {}, h('b', {}, `${T.title} · ${seed.id}`), close), msg, list)
  document.body.append(pill, sheet)

  const say = (text: string): void => { msg.textContent = text; msg.hidden = !text }
  const press = (key: string, v: 'merge' | 'needs-work', note?: string): void => {
    const before = features
    const next = phonePress(features, key, v)
    const sent = next.verdict ? note || undefined : undefined
    // answers-44b: the note belongs to this verdict (the CLI keeps it with it, drops it without one)
    features = next.features.map((f) => { if (f.key !== key) return f; const { note: _old, ...rest } = f; return sent ? { ...rest, note: sent } : rest }); render()
    postVerdict(deps.fetchFn, key, next.verdict, sent).then(() => { say('') }, (e: Error) => { features = before; render(); say(T.failed(e.message)) })
  }
  const row = (r: PhoneRow): HTMLElement => {
    const btn = (v: 'merge' | 'needs-work', label: string): HTMLButtonElement => {
      const on = r.verdict === v
      const b = h('button', { type: 'button', className: 'twpp-v' + (on ? ' on' : ' tw-off'), textContent: (on ? '✓ ' : '') + label })
      b.setAttribute('aria-pressed', String(on))
      b.onclick = () => { press(r.key, v, v === 'needs-work' ? noteBox.value.trim() : undefined) }
      return b
    }
    // wave44 answers-44b: an optional note (P7: small, greyed) that Needs work sends; the stored one shows.
    const noteBox = h('textarea', { className: 'twpp-note', rows: 1, placeholder: S.verdictNote.ph, value: features.find((f) => f.key === r.key)?.note ?? '' })
    noteBox.setAttribute('aria-label', S.verdictNote.aria)
    noteBox.dataset.twppNote = r.key
    const note = h('button', { type: 'button', className: 'twpp-v', textContent: T.note })
    note.onclick = () => { void deps.copy(noteText(seed.id, features.find((f) => f.key === r.key)!)).then(() => { say(T.noteCopied) }) }
    const article = h('article', { className: 'twpp-row' })
    article.dataset.key = r.key
    article.append(
      h('div', { className: 'twpp-t' }, h('span', { className: 'twpp-state', title: r.loaded ? T.loaded : T.notLoaded, textContent: r.loaded ? '☑' : '☐' }), h('b', {}, r.title)),
      ...(r.where ? [h('p', { className: 'twpp-where' }, `${T.where}: ${r.where}`)] : []),
      ...(r.steps.length ? [h('details', {}, h('summary', {}, T.steps), h('ol', {}, ...r.steps.map((s) => h('li', {}, s))))] : []),
      noteBox,
      h('div', { className: 'twpp-btns' }, btn('merge', T.like), btn('needs-work', T.needsWork), note))
    return article
  }
  const render = (): void => { const rows = phoneRows(features); list.replaceChildren(...(rows.length ? rows.map(row) : [h('p', {}, T.empty)])) }
  const open = (on: boolean): void => {
    sheet.hidden = !on; pill.hidden = on
    document.documentElement.classList.toggle('twpp-open', on)
    if (on) void fresh()
  }
  // The registry may have moved since the page loaded (the Mac panel, another phone): read it each time the sheet opens.
  const fresh = async (): Promise<void> => {
    const r = await fetch('/__tw/preview').catch(() => null)
    const j = r?.ok ? ((await r.json().catch(() => null)) as Seed | null) : null
    if (j?.features) { features = j.features; render() }
  }
  // The Approve-wave box (dev_feature.ts, draggable) can sit where the pill rests: the pill stands on top of it, never under it (D-P06).
  const lift = (): void => {
    const ok = document.querySelector('.twf-ok')?.getBoundingClientRect()
    pill.style.bottom = ok && ok.height > 0 ? `${String(Math.ceil(innerHeight - ok.top + 8))}px` : ''
  }
  setInterval(lift, 400)
  pill.onclick = () => { open(true) }
  close.onclick = () => { open(false) }
  render()
}
