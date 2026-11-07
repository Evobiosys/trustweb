// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Living styleguide (design system t9): every token with its live computed value, type, shape, the six
// node states, the trust path and the motion gate. Fixture names only; it never reads a record.
import './design/tokens.css'
import './components/rings.css'
import './styleguide.css'
import tokens from './design/tokens.json'
import voiceUrl from '../../../docs/design/voice.txt?url'
import { applyTheme, readTheme, type Theme } from './theme'
import { motionAllowed } from './motion_gate'
import { renderTrustPath } from './trust_path'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const root = document.documentElement
const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
const SVG = 'http://www.w3.org/2000/svg'
const svg = (tag: string, attrs: Record<string, string>): SVGElement => {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

function theme(): void {
  const box = $('theme')
  const labels: Array<[Theme, string]> = [['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']]
  const mark = (): void => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === root.dataset.theme)))
  for (const [t, label] of labels) {
    const b = el('button', undefined, label)
    b.dataset.theme = t
    b.onclick = () => { applyTheme(t, root, localStorage); mark(); refreshTokens() }
    box.append(b)
  }
  root.dataset.theme = readTheme(localStorage)
  mark()
}

function refreshTokens(): void {
  const cs = getComputedStyle(root)
  document.querySelectorAll<HTMLElement>('#tokens .sw').forEach((sw) => {
    const v = cs.getPropertyValue('--' + sw.dataset.token).trim()
    sw.querySelector('small:last-child')!.textContent = v
    sw.querySelector<HTMLElement>('i')!.style.background = `var(--${sw.dataset.token})`
  })
}

function swatches(): void {
  const box = $('tokens')
  const add = (name: string, role: string): void => {
    const sw = el('div', 'sw')
    sw.dataset.token = name
    sw.append(el('i'))
    const text = el('div')
    text.append(el('b', undefined, '--' + name), el('small', undefined, role), el('small'))
    sw.append(text)
    box.append(sw)
  }
  for (const name of Object.keys(tokens.core)) add(name, 'core')
  for (const name of Object.keys(tokens.one.light)) add(name, 'colour, light and dark')
  refreshTokens()
}

function typeAndShape(): void {
  const t = $('type')
  t.className = 'sg-type'
  const samples: Array<[string, string]> = [['font-serif', 'fs-6'], ['font-sans', 'fs-4'], ['font-sans', 'fs-3'], ['font-sans', 'fs-2'], ['font-sans', 'fs-1'], ['font-mono', 'fs-1']]
  for (const [f, s] of samples) {
    const p = el('p', undefined, `Lena shared this with you (${f}, ${s})`)
    p.style.fontFamily = `var(--${f})`
    p.style.fontSize = `var(--${s})`
    t.append(p)
  }
  const shape = $('shape')
  for (const r of ['r-people', 'r-card', 'r-control', 'r-chip', 'r-sheet']) {
    const b = el('div', 'sg-shape', r)
    b.style.borderRadius = `var(--${r})`
    shape.append(b)
  }
  for (let i = 1; i <= 8; i++) {
    const b = el('span', 'sg-space')
    b.style.width = `var(--s-${i})`
    b.title = `s-${i}`
    shape.append(b)
  }
}

type Fixture = { name: string; cls: string; x: number; y: number }
function node(f: Fixture, tone?: string): HTMLElement {
  const n = el('div', `node ${f.cls}`.trim())
  n.style.left = f.x + 'px'
  n.style.top = f.y + 'px'
  const ava = el('i', 'ava', f.name[0])
  ava.style.background = f.cls.includes('you') ? '' : 'var(--person-default)'
  if (f.cls.includes('intending')) ava.style.background = ''
  if (tone) n.dataset.tone = tone
  n.append(ava, el('span', undefined, f.name))
  return n
}

function guides(wrap: HTMLElement, radii: number[], cx: number, cy: number): void {
  const s = svg('svg', { width: String(wrap.clientWidth || 352), height: wrap.style.height || '352', 'aria-hidden': 'true' })
  for (const r of radii) s.append(svg('circle', { cx: String(cx), cy: String(cy), r: String(r), fill: 'none', stroke: 'var(--line-strong)', 'stroke-width': '1' }))
  wrap.append(s)
}

function rings(): void {
  const wrap = el('div', 'rings-wrap')
  guides(wrap, [60, 110, 160], 176, 176)
  const fixtures: Fixture[] = [
    { name: 'You', cls: 'you', x: 176, y: 176 },
    { name: 'Lena', cls: 'shared', x: 176, y: 116 },
    { name: 'Mara', cls: 'asked', x: 236, y: 176 },
    { name: 'Ines', cls: 'nonresp', x: 116, y: 176 },
    { name: 'Tomas', cls: 'intending', x: 276, y: 96 },
    { name: 'Noor', cls: 'live', x: 176, y: 286 },
  ]
  for (const f of fixtures) wrap.append(node(f))
  $('rings').append(wrap)
  const legend = el('div', 'sg-states')
  const says: Array<[string, string]> = [
    ['you', 'You: teal glow'], ['shared', 'Shared with you: double ring'], ['asked', 'Asked: soft pulse'],
    ['nonresp', 'Quiet: dimmed, a fact about timing'], ['intending', 'Intending: dashed outline'], ['live', 'Live: presence ring'],
  ]
  for (const [cls, text] of says) {
    const item = el('div')
    item.append(el('code', undefined, '.node.' + cls), document.createElement('br'), text)
    legend.append(item)
  }
  $('rings').append(legend)
}

function trustPath(): void {
  const wrap = el('div', 'rings-wrap')
  wrap.style.width = '352px'
  const pts = [{ x: 40, y: 100 }, { x: 160, y: 50 }, { x: 310, y: 100 }]
  const names = ['You', 'Lena', 'Mara']
  const { d, label } = renderTrustPath(pts, names)
  const s = svg('svg', { width: '352', height: '150', role: 'img', 'aria-label': label })
  s.append(svg('path', { d, class: 'trust-path' }))
  wrap.append(s)
  names.forEach((name, i) => wrap.append(node({ name, cls: i === 0 ? 'you' : i === 1 ? 'on-path' : '', x: pts[i].x, y: pts[i].y })))
  $('path').append(wrap, el('p', 'sg-note', label))
}

function motion(): void {
  let simulate = false
  const mq = matchMedia('(prefers-reduced-motion: reduce)')
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; addEventListener?: (t: 'change', f: () => void) => void } }).connection
  const apply = (): void => {
    const env = { reducedMotion: mq.matches, saveData: conn?.saveData, effectiveType: simulate ? '3g' : conn?.effectiveType }
    root.dataset.motion = motionAllowed(env) ? 'on' : 'off'
    const reasons = [mq.matches && 'reduced motion asked', env.saveData && 'data saver on', env.effectiveType && ['slow-2g', '2g', '3g'].includes(env.effectiveType) && `slow connection (${env.effectiveType}${simulate ? ', simulated' : ''})`].filter(Boolean)
    $('motion-out').textContent = `data-motion="${root.dataset.motion}"` + (reasons.length ? ` because: ${reasons.join(', ')}` : ' (nothing asks for less)')
  }
  const btn = $('simulate')
  btn.onclick = () => { simulate = !simulate; btn.setAttribute('aria-pressed', String(simulate)); apply() }
  mq.addEventListener('change', apply)
  conn?.addEventListener?.('change', apply)
  apply()
}

function voice(): void {
  const btn = $('load-voice')
  btn.onclick = async () => {
    const pre = $('voice-text')
    try { pre.textContent = await (await fetch(voiceUrl)).text() } catch { pre.textContent = 'The voice text did not load.' }
    pre.hidden = false
  }
}

theme()
swatches()
typeAndShape()
rings()
trustPath()
motion()
voice()
