// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: the assistant panel (the sparkle). A chat with the person's own AI; every change it proposes is a card with
 * Approve / Skip (applied at once only with "Apply as I watch"), each undoable, and "Done? Review" lists what changed. On a phone a
 * sheet at the bottom that expands; from 900 px a pane on the right. Built on first open, inside its own shadow root; talks to the
 * app only through TwCtx (actions, store, strings).
 */
import { el } from '../../../../demo/src/ui/dom'
import type { Valid } from '../../actions'
import { PLACES } from '../../app_actions'
import { searchEngineUrl } from '../../ask_web_search'
import { ownChannels } from '../../channel_readers'
import { loadColourTags } from '../../colour_tags'
import { allProfiles } from '../profiles'
import { askEndpointText, configured } from '../../llm_endpoint'
import { readLook } from '../../look'
import { pendingProposals } from '../../services_import'
import { listModules } from '../registry'
import type { TwCtx } from '../tw_registry'
import css from './assistant.css?inline'
import { createApproval, type Card } from './approval'
import { streamChat, type ChatMessage } from './chat_stream'
import { lookupQuestion, quickLook, type LookTarget } from './person_context'
import { aiRowName, mentionedPeople, parseAssistantReply, systemPrompt, visibleText } from './protocol'

const WATCH_KEY = 'tw-assistant-watch'
const PANE = 'tw-assistant-pane'
const HISTORY = 12

interface Look { title: string; quick: string[]; longer: string; longerState: 'none' | 'busy' | 'done' | 'failed'; name: string; image?: { src: string; page?: string } | 'asking' | 'consent' | 'none' }
interface Msg { role: 'user' | 'assistant'; text: string; raw?: string; cards?: number[]; rejected?: number; done?: boolean; look?: Look; noAi?: boolean }

export function createPanel(ctx: TwCtx) {
  const T = ctx.strings.assistant
  const actions = ctx.actions
  if (!actions) throw new Error('assistant: the host gave no actions')
  const msgs: Msg[] = []
  let watch = (() => { try { return localStorage.getItem(WATCH_KEY) === '1' } catch { return false } })()
  const approval = createApproval({ run: (a: Valid) => actions.run(a, 'assistant') }, { auto: () => watch })
  let busy: AbortController | null = null
  /** Review wave 40: the running person lookup; closing the panel stops it too. */
  let lookCtl: AbortController | null = null
  /** Phone only: min = just the header (the assistant brought me somewhere and I look at it), normal, big. */
  let size: 'min' | 'normal' | 'big' = 'normal'
  let reviewOpen = false

  const hostEl = el('div', { 'data-assistant': '' })
  const root = hostEl.attachShadow({ mode: 'open' })
  const wrap = el('section', { class: 'as', role: 'dialog', 'aria-label': T.title, 'data-assistant-panel': '' })
  const log = el('div', { class: 'log', 'data-assistant-log': '', 'aria-live': 'polite' })
  const foot = el('div', { class: 'foot' })
  const input = el('textarea', { placeholder: T.placeholder, 'aria-label': T.placeholder, 'data-assistant-input': '', rows: '1' }) as HTMLTextAreaElement
  const sendBtn = el('button', { class: 'send', 'data-assistant-send': '', onclick: () => (busy ? busy.abort() : send()) }, [T.send])
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) send() } })
  const head = el('header', { class: 'head' })
  wrap.append(head, log, foot, el('div', { class: 'composer' }, [input, sendBtn]))
  root.append(el('style', {}, [css]), wrap)
  approval.onChange(() => draw())

  const ai = () => ctx.store().advanced?.ai
  const wide = (): boolean => window.matchMedia('(min-width: 900px)').matches
  const lnk = (label: string, onclick: () => void, attrs: Record<string, string> = {}, cls = 'lnk'): HTMLElement => el('button', { class: cls, onclick, ...attrs }, [label])

  function drawHead(): void {
    const box = el('input', { type: 'checkbox', 'data-assistant-watch': '', ...(watch ? { checked: '' } : {}), onchange: (e: Event) => { watch = (e.target as HTMLInputElement).checked; try { localStorage.setItem(WATCH_KEY, watch ? '1' : '0') } catch { /* this session only */ } } })
    head.replaceChildren(
      el('h2', {}, [T.title, el('sub', { class: 'alpha', 'data-alpha-label': '' }, [ctx.strings.alphaLabel])]),
      el('label', { class: 'watch', title: T.watchHint }, [box, T.watch]),
      lnk(size === 'min' ? T.showChat : size === 'big' ? T.shrink : T.expand, () => resize(size === 'normal' ? 'big' : 'normal'), { 'data-assistant-expand': size }, 'lnk expand'),
      lnk('✕', close, { 'aria-label': T.close, 'data-assistant-close': '' }),
    )
  }

  function resize(to: typeof size): void {
    size = wide() ? 'normal' : to
    wrap.classList.toggle('big', size === 'big')
    wrap.classList.toggle('min', size === 'min')
    drawHead()
  }
  // On a phone the sheet would hide the place the assistant just opened: it folds to its header until I open it again.
  const offRun = actions.onRun((a, by) => { if (by === 'assistant' && a.type === 'open' && !hostEl.hidden) resize('min') })

  function cardView(c: Card): HTMLElement {
    const btns: HTMLElement[] = []
    if (c.state === 'proposed') btns.push(lnk(T.approve, () => approval.approve(c.id), { 'data-assistant-approve': String(c.id) }, 'lnk strong'), lnk(T.skip, () => approval.skip(c.id), { 'data-assistant-skip': String(c.id) }))
    if (c.state === 'applied' && c.action.undoable) btns.push(lnk(T.undo, () => approval.undo(c.id), { 'data-assistant-undo': String(c.id) }))
    return el('div', { class: `card ${c.state}`, 'data-assistant-card': String(c.id), 'data-state': c.state }, [
      el('b', {}, [c.action.label]),
      c.action.why ? el('span', { class: 'meta' }, [c.action.why]) : null,
      c.error ? el('span', { class: 'warn' }, [c.error]) : null,
      el('div', { class: 'row' }, [el('span', { class: 'state' }, [T.state[c.state] + (c.action.undoable ? '' : ` · ${T.noUndo}`)]), ...btns]),
    ])
  }

  function lookView(m: Msg, l: Look): HTMLElement {
    const engine = searchEngineUrl(ctx.store().askEngineUrl, l.name)
    const img = l.image
    return el('div', { class: 'look', 'data-assistant-look': '' }, [
      el('b', {}, [l.title]),
      el('p', { class: 'meta' }, [T.lookQuick]),
      el('ul', { 'data-assistant-look-quick': '' }, l.quick.map((x) => el('li', {}, [x]))),
      el('p', { class: 'meta' }, [T.lookLonger]),
      el('p', { class: 'msg', 'data-assistant-look-longer': l.longerState }, [l.longerState === 'none' ? T.lookNoAi : l.longerState === 'busy' && !l.longer ? T.thinking : l.longer]),
      el('div', { class: 'row', style: 'display:flex;gap:12px;flex-wrap:wrap' }, [
        engine ? el('a', { href: engine, target: '_blank', rel: 'noopener noreferrer', 'data-assistant-search': '' }, [T.lookSearch]) : null,
        configured(ai()) && !img ? lnk(T.lookImage, () => { l.image = 'consent'; draw() }, { 'data-assistant-image': '' }) : null,
      ]),
      img === 'consent' ? el('div', { class: 'review', 'data-assistant-image-consent': '' }, [
        el('p', {}, [T.lookImageConsent(l.name)]),
        el('div', { class: 'row', style: 'display:flex;gap:12px' }, [lnk(T.lookImageYes, () => void findImage(m, l), { 'data-assistant-image-yes': '' }, 'lnk strong'), lnk(T.lookImageNo, () => { l.image = undefined; draw() })]),
      ]) : null,
      img === 'asking' ? el('p', { class: 'meta' }, [T.thinking]) : null,
      img === 'none' ? el('p', { class: 'meta' }, [T.lookImageNone]) : null,
      img && typeof img === 'object' ? el('div', {}, [
        el('img', { src: img.src, alt: l.name, referrerpolicy: 'no-referrer', loading: 'lazy', 'data-assistant-image-shown': '' }),
        img.page ? el('a', { href: img.page, target: '_blank', rel: 'noopener noreferrer' }, [T.lookImageFrom]) : null,
      ]) : null,
    ])
  }

  function msgView(m: Msg): HTMLElement {
    if (m.role === 'user') return el('div', { class: 'msg user', 'data-assistant-msg': 'user' }, [m.text])
    if (m.look) return el('div', { class: 'msg assistant' }, [lookView(m, m.look)])
    const cards = approval.cards().filter((c) => m.cards?.includes(c.id))
    const waiting = cards.filter((c) => c.state === 'proposed' && c.action.auto).length   // Approve all leaves the ones that need their own Approve
    return el('div', { class: 'msg assistant', 'data-assistant-msg': 'assistant' }, [
      m.text || (busy && m === msgs[msgs.length - 1] ? T.thinking : ''),
      m.noAi ? el('div', { 'data-assistant-noai': '' }, [el('p', { class: 'meta' }, [T.noAiMore]), lnk(T.noAiLink, () => { close(); actions!.do('open', { place: 'your-ai' }) }, { 'data-assistant-plans': '' }, 'lnk strong')]) : null,
      ...cards.map(cardView),
      waiting > 1 ? lnk(T.approveAll(waiting), () => approval.approveAll(), { 'data-assistant-approve-all': '' }) : null,
      m.rejected ? el('p', { class: 'warn', 'data-assistant-rejected': String(m.rejected) }, [T.rejected(m.rejected)]) : null,
    ])
  }

  function reviewView(): HTMLElement {
    const s = approval.summary()
    const all = approval.cards()
    return el('div', { class: 'review', 'data-assistant-review': '' }, [
      el('h3', {}, [T.reviewTitle]),
      el('p', { class: 'meta' }, [all.length ? T.reviewLine(s.applied.length, s.skipped.length + s.undone.length, s.proposed.length) : T.reviewEmpty]),
      el('ol', {}, all.map((c) => el('li', { 'data-assistant-review-item': c.state }, [
        `${c.action.label} · ${T.state[c.state]} `,
        c.state === 'applied' && c.action.undoable ? lnk(T.undo, () => approval.undo(c.id), { 'data-assistant-review-undo': String(c.id) }) : null,
      ]))),
      lnk(T.reviewClose, () => { reviewOpen = false; draw() }, { 'data-assistant-review-close': '' }),
    ])
  }

  function draw(): void {
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40
    log.replaceChildren(
      ...(msgs.length ? [] : [el('p', { class: 'meta', 'data-assistant-hello': '' }, [configured(ai()) ? T.hello : T.noAi])]),
      ...(!msgs.length && !configured(ai()) ? [lnk(T.noAiLink, () => { close(); actions!.do('open', { place: 'your-ai' }) }, { 'data-assistant-plans': '' }, 'lnk strong')] : []),
      ...msgs.map(msgView),
      ...(reviewOpen ? [reviewView()] : []),
    )
    foot.replaceChildren(...(approval.cards().length && !reviewOpen ? [lnk(T.review, () => { reviewOpen = true; draw(); log.scrollTop = log.scrollHeight }, { 'data-assistant-review-open': '' })] : []))
    sendBtn.textContent = busy ? T.stop : T.send
    if (atEnd) log.scrollTop = log.scrollHeight
  }

  function context(text: string) {
    const s = ctx.store()
    const tags = loadColourTags()
    return systemPrompt({
      specs: actions!.specs(), where: ctx.where?.() ?? '', profile: ctx.profile(), look: readLook(localStorage),
      variations: allProfiles(s.twSettings).map((p) => p.id), modules: listModules().map((m) => m.id), places: PLACES,
      recent: actions!.recent().map((r) => `${r.by}: ${r.label}`),
      rows: pendingProposals(s, Date.now()).slice(0, 60).map((x) => ({ key: x.row.key, name: aiRowName(x.row.name), labels: x.row.labels, ring: x.row.ring ?? x.proposal.ring, note: x.row.note })),
      people: mentionedPeople(s.people.filter((p) => !p.deleted_at && p.ring !== 'none'), text, 20).map((p) => ({ id: p.id, name: p.name, ring: p.ring, tags: tags.filter((t) => String(p.fields?.[t.id]) === 'true').map((t) => t.label ?? t.id) })),
    })
  }

  async function send(): Promise<void> {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    reviewOpen = false
    msgs.push({ role: 'user', text })
    const endpoint = ai()
    if (!configured(endpoint)) { msgs.push({ role: 'assistant', text: T.noAi, noAi: true }); draw(); return }
    const m: Msg = { role: 'assistant', text: '', raw: '' }
    const history: ChatMessage[] = msgs.filter((x) => !x.look && !x.noAi && (x.role === 'user' || x.raw)).slice(-HISTORY).map((x) => ({ role: x.role, content: x.role === 'user' ? x.text : x.raw ?? '' }))
    msgs.push(m)
    busy = new AbortController()
    draw()
    try {
      const full = await streamChat(endpoint, [{ role: 'system', content: context(text) }, ...history], (t) => { m.raw = t; m.text = visibleText(t); draw() }, busy.signal, ownChannels(ctx.store()))
      const r = parseAssistantReply(full, actions!.check)
      m.raw = full
      m.text = r.say
      m.rejected = r.rejected.length
      busy = null
      m.cards = approval.add(r.actions).map((c) => c.id)
      if (r.done) reviewOpen = true
    } catch (e) {
      m.text = T.failed((e as Error).name === 'AbortError' ? T.stop : (e as Error).message)
    } finally { busy = null; draw() }
  }

  /** The person lookup: the quick answer from this device at once, then the longer one from the person's own AI. */
  async function lookUp(target: LookTarget): Promise<void> {
    const s = ctx.store()
    const tags = loadColourTags()
    const name = 'personId' in target ? s.people.find((p) => p.id === target.personId)?.name ?? '' : target.row.name
    const l: Look = { title: T.lookTitle(name), quick: quickLook(s, target, tags), longer: '', longerState: configured(ai()) ? 'busy' : 'none', name }
    const m: Msg = { role: 'assistant', text: '', look: l }
    msgs.push(m)
    draw()
    const endpoint = ai()
    if (!configured(endpoint)) return
    lookCtl?.abort()
    const ctl = new AbortController()
    lookCtl = ctl
    try {
      const sys = 'You help someone remember a contact. Say in 4 to 8 short lines what is publicly known about this person (role, work, where they are active). If you can search the web, do it and name the sources. Say plainly when you are not sure or the name is common. Never guess private details.'
      await streamChat(endpoint, [{ role: 'system', content: sys }, { role: 'user', content: lookupQuestion(s, target, tags) }], (t) => { l.longer = visibleText(t); draw() }, ctl.signal, ownChannels(s), 600)
      l.longerState = 'done'
    } catch (e) { l.longer = T.failed((e as Error).message); l.longerState = 'failed' }
    draw()
  }

  /** Only after the consent line: asks the AI for one picture address; https only, shown without a referrer. */
  async function findImage(_m: Msg, l: Look): Promise<void> {
    const endpoint = ai()
    if (!configured(endpoint)) return
    l.image = 'asking'; draw()
    try {
      const txt = await askEndpointText(endpoint, 'Answer only with JSON {"image":"https://... (a .jpg or .png address)","page":"https://... (the page it is on)"}, or {"image":null} when you find none.', `Find one public photo of this person on the web: ${l.name}`)
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}')
      const got = (a >= 0 && b > a ? JSON.parse(txt.slice(a, b + 1)) : null) as { image?: unknown; page?: unknown } | null
      const ok = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u)
      l.image = ok(got?.image) ? { src: got.image, ...(ok(got?.page) ? { page: got.page } : {}) } : 'none'
    } catch { l.image = 'none' }
    draw()
  }

  function open(): void {
    if (!hostEl.isConnected) document.body.append(hostEl)
    hostEl.hidden = false
    if (size === 'min') size = 'normal'
    wrap.classList.remove('min')
    document.documentElement.classList.toggle(PANE, wide())
    drawHead(); draw()
    input.focus({ preventScroll: true })
  }
  function close(): void {
    busy?.abort()
    lookCtl?.abort()
    hostEl.hidden = true
    document.documentElement.classList.remove(PANE)
  }
  const onResize = (): void => { if (!hostEl.hidden && hostEl.isConnected) document.documentElement.classList.toggle(PANE, wide()) }
  window.addEventListener('resize', onResize)

  return {
    open,
    close,
    toggle(): void { if (hostEl.isConnected && !hostEl.hidden && size !== 'min') close(); else open() },
    person(target: LookTarget): void { open(); void lookUp(target) },
    dispose(): void { close(); offRun(); window.removeEventListener('resize', onResize); hostEl.remove() },
  }
}
