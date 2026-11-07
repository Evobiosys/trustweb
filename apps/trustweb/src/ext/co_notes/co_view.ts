// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 (co-notes): the extension's screen parts (settings switch, list under Resources > Notes), the store and the relay timers. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { ExtHooks, ExtModule } from '../registry'
import { newDoc, type CoDoc, type CoPerson } from './co_doc'
import { openCoNote, type CoCtx } from './co_editor'
import { audit, pollDocs, receive, sendDoc } from './co_sync'

const SEND_DELAY_MS = 3000
const S_ = S.coNotes

export const coNotesScreen: ExtModule['screen'] = (h: ExtHooks) => {
  const st = (): ReturnType<ExtHooks['state']> => h.state()
  const docs = (): CoDoc[] => st().coNotes ?? []
  const me = (): CoPerson => ({ did: h.me().did ?? 'local', name: h.me().name || '?' })
  const known = (did: string): boolean => st().people.some((p) => h.didOf(p.id) === did)
  const log = (line: string): void => { st().coNotesLog = audit(st().coNotesLog, line, Date.now()) }
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  /** A few seconds after the last edit the whole document goes out sealed to each participant (not keystroke by keystroke). */
  const push = async (id: string): Promise<void> => {
    const r = h.relay()
    const d = docs().find((x) => x.id === id)
    if (!r || !d) return
    const n = await sendDoc(r.deps, d, r.identity, known)
    if (n) { log(`Sent "${d.title}" to ${n} ${n === 1 ? 'person' : 'people'}`); h.save() }
  }
  const schedule = (id: string): void => {
    clearTimeout(timers.get(id))
    timers.set(id, setTimeout(() => { timers.delete(id); void push(id) }, SEND_DELAY_MS))
  }

  const put = (doc: CoDoc, quiet = false): void => {
    st().coNotes = docs().some((d) => d.id === doc.id) ? docs().map((d) => (d.id === doc.id ? doc : d)) : [...docs(), doc]
    h.save()
    if (!quiet) schedule(doc.id)
  }

  const poll = async (): Promise<boolean> => {
    const r = h.relay()
    if (!r || !st().coNotesOn) return false
    let changed = 0
    for (const { from, doc } of await pollDocs(r.deps, r.identity, known)) {
      const out = receive(docs(), from, doc, known)
      if (!out) continue
      st().coNotes = out.docs
      log(out.line)
      changed++
    }
    if (changed) { h.save(); h.toast(S_.arrived(changed)) }
    return changed > 0
  }

  const ctx: CoCtx = { h, me, get: (id) => docs().find((d) => d.id === id), put, poll }

  const create = (): void => {
    const d = newDoc({ id: h.newId() + Date.now().toString(36), title: S_.untitled, me: me(), at: Date.now() })
    put(d, true)
    openCoNote(ctx, d.id)
  }

  const list = (): HTMLElement => el('div', { class: 'co-list', 'data-co-list': '' }, [
    el('h4', { class: 'eyebrow' }, [S_.listTitle]),
    ...(docs().length
      ? docs().map((d) => el('button', { class: 'co-open', 'data-co-open': d.id, onclick: () => openCoNote(ctx, d.id) }, [d.title || S_.untitled]))
      : [el('p', { class: 'meta' }, [S_.listEmpty])]),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-co-new': '', onclick: create }, [S_.newBtn]),
  ])

  const on = (): boolean => st().coNotesOn === true
  return {
    body: () => [],
    notesSection: () => (on() ? [list()] : []),
    settingsRows: () => [
      el('button', {
        class: 'radio' + (on() ? ' on' : ''), 'aria-pressed': String(on()), 'data-ext-co-notes': '',
        onclick: () => { if (on()) delete st().coNotesOn; else st().coNotesOn = true; h.save(); h.redraw() },
      }, [el('b', {}, [S_.label]), el('small', {}, [S_.hint])]),
    ],
    start: () => { if (on()) void poll().then((changed) => { if (changed) h.redraw() }) },
    poll,
  }
}
