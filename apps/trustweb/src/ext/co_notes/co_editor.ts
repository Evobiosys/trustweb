// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 (co-notes): the editor of one co-created note, as an outliner or as plain text. DOM only; every change is a co_doc.ts op. */
import { el } from '../../../../demo/src/ui/dom'
import { chipInput } from '../../chip_input'
import { matchPeople } from '../../events'
import { configured } from '../../llm_endpoint'
import type { Person } from '../../model'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'
import { canEdit, combine, cycleShare, isEventDoc, mineId, SHARE_LABELS } from './co_desires'
import { editText, fromText, indent, insertAfter, moveDown, moveUp, outdent, remove, setLogseq, setShare, setTitle, textOver, toText, tree, type CoDoc, type CoPerson } from './co_doc'
import { chipToken, fromEdit, fromLogseq, logseqUrl, parseChips, parseLogseqRef, refsOf, toEdit, toLogseq } from './co_links'

export interface CoCtx {
  h: ExtHooks
  me: () => CoPerson
  get: (id: string) => CoDoc | undefined
  /** Stores the document; `quiet` = a view setting, nothing to send. */
  put: (doc: CoDoc, quiet?: boolean) => void
  /** Fetches what others left; true when a document changed. */
  poll: () => Promise<boolean>
  /** One line for the local log (I6). */
  log: (line: string) => void
}

const POLL_MS = 10_000
const AT = /@([^\s@[\]]{0,30})$/
const S_ = S.coNotes
const D_ = S.coDesires

export function openCoNote(c: CoCtx, id: string): void {
  const d = c.get(id)
  if (d) c.h.page(d.title, [coEditor(c, id)], 'co-note')
}

export function coEditor(c: CoCtx, id: string): HTMLElement {
  const root = el('div', { class: 'co-editor', 'data-co-editor': id })
  const folded = new Set<string>()
  const refs = refsOf(c.get(id) as CoDoc)
  let editing = ''
  let adding = false
  /** The copy the plain-text box shows; typing applies against it, so lines others added meanwhile are not taken for deleted. */
  let base: CoDoc | null = null
  const doc = (): CoDoc => c.get(id) as CoDoc
  const people = (): Person[] => c.h.state().people
  const personOf = (ref: string): Person | undefined => (ref.startsWith('tw:') ? people().find((p) => p.id === ref.slice(3)) : people().find((p) => c.h.didOf(p.id) === ref))
  const field = (): HTMLInputElement | HTMLTextAreaElement | null => root.querySelector('[data-co-input]')

  const commit = (): void => {
    const f = field()
    const d = c.get(id)
    if (!f || !d || f.value === f.defaultValue) return
    let next: CoDoc
    if (f instanceof HTMLTextAreaElement) {
      const r = textOver(base ?? d, d, fromEdit(f.value, refs), c.me(), Date.now())
      next = r.doc
      base = r.base
      f.defaultValue = f.value
    } else next = editText(d, f.dataset.coInput ?? '', fromEdit(f.value, refs), c.me())
    if (next !== d) c.put(next)
  }
  /** Commits what is typed, applies one op, shows the result with the cursor in `editing`. */
  const act = (fn: (d: CoDoc) => CoDoc): void => {
    commit()
    const d = doc()
    const next = fn(d)
    if (next !== d) c.put(next)
    draw()
  }
  /** Desires and memories: the top level is each person's chip, and only the author edits a line. New lines start at 'me' (I9). */
  const evDoc = (): boolean => isEventDoc(doc())
  const editable = (bid: string, depth: number): boolean => canEdit(doc(), bid, c.me()) && !(evDoc() && depth === 0)
  const newOpts = (): { share?: 'me' } => (evDoc() ? { share: 'me' } : {})
  const start = (bid: string): void => { commit(); editing = bid; draw() }

  const chipEl = (name: string, ref: string): HTMLElement => {
    const p = personOf(ref)
    return p
      ? el('button', { class: 'co-chip', 'data-co-chip': ref, 'aria-label': S_.chipOpen(name), onclick: (e: Event) => { e.stopPropagation(); c.h.openPerson(p.id) } }, [`@${name}`])
      : el('span', { class: 'co-chip-plain' }, [`@${name}`])
  }
  const shown = (text: string): Node[] => parseChips(text).map((p) => ('chip' in p ? chipEl(p.chip.name, p.chip.ref) : document.createTextNode(p.text)))

  /** Typing @ lists the people of my web under the field; a pick writes `@[Name]` and remembers whose it is. */
  const mention = (f: HTMLInputElement | HTMLTextAreaElement): HTMLElement => {
    const hits = el('div', { class: 'share-hits co-hits', 'data-co-hits': '' })
    f.addEventListener('input', () => {
      const caret = f.selectionStart ?? f.value.length
      const m = AT.exec(f.value.slice(0, caret))
      hits.replaceChildren(...(m ? matchPeople(people(), m[1]) : []).map((p) => el('button', {
        class: 'chip', 'data-co-hit': p.id, onmousedown: (e: Event) => e.preventDefault(),
        onclick: () => {
          const ref = c.h.didOf(p.id) ?? `tw:${p.id}`
          const first = parseChips(chipToken(p.name, ref)).find((x) => 'chip' in x)
          const name = first && 'chip' in first ? first.chip.name : p.name
          refs.set(name, ref)
          const at = caret - (m?.[0].length ?? 0)
          f.value = `${f.value.slice(0, at)}@[${name}] ${f.value.slice(caret)}`
          f.setSelectionRange(at + name.length + 4, at + name.length + 4)
          hits.replaceChildren()
          f.focus()
        },
      }, [p.name])))
    })
    return hits
  }

  const keys = (bid: string, rows: { id: string; hasKids: boolean }[]) => (e: KeyboardEvent): void => {
    const f = e.target as HTMLInputElement
    const me = c.me()
    const i = rows.findIndex((r) => r.id === bid)
    if (e.key === 'Enter') { e.preventDefault(); act((d) => { const r = insertAfter(d, bid, '', me, Date.now(), newOpts()); editing = r.id; return r.doc }) }
    else if (e.key === 'Tab') { e.preventDefault(); act((d) => (e.shiftKey ? outdent : indent)(d, bid, me)) }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); act((d) => (e.key === 'ArrowUp' ? moveUp : moveDown)(d, bid, me)) }
    else if (e.key === 'ArrowUp' && rows[i - 1]) { e.preventDefault(); start(rows[i - 1].id) }
    else if (e.key === 'ArrowDown' && rows[i + 1]) { e.preventDefault(); start(rows[i + 1].id) }
    else if (e.key === 'Backspace' && f.value === '' && !rows[i].hasKids) { e.preventDefault(); editing = rows[i - 1]?.id ?? ''; act((d) => remove(d, bid, me)) }
  }

  const tools = (bid: string): HTMLElement => {
    const me = c.me()
    const b = (key: string, label: string, fn: (d: CoDoc, id: string, me: CoPerson) => CoDoc): HTMLElement =>
      el('button', { class: 'btn btn-ghost btn-sm', 'data-co-tool': key, onmousedown: (e: Event) => e.preventDefault(), onclick: () => act((d) => fn(d, bid, me)) }, [label])
    return el('div', { class: 'co-toolbar', 'data-co-toolbar': '' }, [...(evDoc() ? [] : [b('indent', S_.indent, indent), b('outdent', S_.outdent, outdent)]), b('up', S_.up, moveUp), b('down', S_.down, moveDown)])
  }

  /** One tap moves a line me -> event -> zones; other people's lines only show theirs. */
  const shareChip = (bid: string, level: 'me' | 'event' | 'zones' | undefined, mine: boolean): HTMLElement => {
    const label = SHARE_LABELS[level ?? 'me']
    return mine
      ? el('button', { class: 'co-share', 'data-co-share': level ?? 'me', 'aria-label': `${D_.shareTap}: ${label}`, onclick: () => act((d) => setShare(d, bid, cycleShare(level), c.me())) }, [label])
      : el('span', { class: 'co-share-plain meta', 'data-co-share-plain': level ?? 'me' }, [label])
  }

  const outline = (d: CoDoc): HTMLElement => {
    const rows = tree(d, folded)
    const list = el('div', { class: 'co-blocks', role: 'tree' })
    for (const r of rows) {
      const isEditing = r.id === editing && editable(r.id, r.depth)
      const toggle = r.hasKids
        ? el('button', { class: 'outline-toggle', 'aria-label': S_.fold, 'aria-expanded': String(!folded.has(r.id)), 'data-co-fold': r.id, onclick: () => { commit(); if (folded.has(r.id)) folded.delete(r.id); else folded.add(r.id); draw() } }, [folded.has(r.id) ? '▸' : '▾'])
        : el('span', { class: 'outline-toggle' }, ['•'])
      const text = isEditing
        ? el('input', { class: 'field co-input', value: toEdit(r.text), maxlength: '500', placeholder: S_.blockPh, 'aria-label': S_.blockPh, 'data-co-input': r.id, autocomplete: 'off', onkeydown: (e: Event) => keys(r.id, rows)(e as KeyboardEvent), onblur: commit }) as HTMLInputElement
        : editable(r.id, r.depth)
          ? el('div', { class: 'co-text', tabindex: '0', 'data-co-text': r.id, onfocus: () => start(r.id), onclick: (e: Event) => { if (!(e.target as HTMLElement).closest('.co-chip')) start(r.id) } }, r.text ? shown(r.text) : [el('span', { class: 'meta' }, [S_.blockPh])])
          : el('div', { class: 'co-text co-readonly' + (evDoc() && r.depth === 0 ? ' co-head' : ''), 'data-co-text': r.id }, shown(r.text))
      const share = evDoc() && r.depth > 0 && !r.ai ? shareChip(r.id, r.share, editable(r.id, r.depth)) : null
      const mark = r.ai ? el('span', { class: 'co-ai', 'data-co-ai': '' }, [D_.aiMade]) : null
      list.append(el('div', { class: 'co-row', role: 'treeitem', 'aria-level': String(r.depth + 1), 'data-co-block': r.id, style: `padding-left:${r.depth * 16}px` }, [toggle, text, mark, share]))
      if (evDoc() && r.id === mineId(c.me()) && !r.hasKids) list.append(el('button', { class: 'btn btn-ghost btn-sm', 'data-co-add-wish': '', onclick: () => act((x) => { const n = insertAfter(x, r.id, '', c.me(), Date.now(), newOpts()); editing = n.id; return indent(n.doc, n.id, c.me()) }) }, [D_.addWish]))
      if (isEditing) list.append(el('div', { class: 'co-under', style: `padding-left:${r.depth * 16 + 22}px` }, [mention(text as HTMLInputElement), tools(r.id)]))
    }
    if (!rows.length && !evDoc()) list.append(el('button', { class: 'btn btn-ghost btn-sm', 'data-co-first': '', onclick: () => act((x) => { const r = insertAfter(x, null, '', c.me(), Date.now()); editing = r.id; return r.doc }) }, [S_.firstLine]))
    return list
  }

  const plain = (d: CoDoc): HTMLElement => {
    const area = el('textarea', { class: 'field co-plain', rows: '12', placeholder: S_.textPh, 'aria-label': S_.modeText, 'data-co-input': 'text', onblur: commit }) as HTMLTextAreaElement
    area.defaultValue = toEdit(toText(d))
    base = d
    return el('div', {}, [area, mention(area)])
  }

  const modeButtons = (d: CoDoc): HTMLElement => el('div', { class: 'co-modes' }, (['outline', 'text'] as const).map((m) => el('button', {
    class: 'btn btn-ghost btn-sm' + (d.mode === m ? ' on' : ''), 'aria-pressed': String(d.mode === m), 'data-co-mode': m,
    onclick: () => { commit(); c.put({ ...doc(), mode: m }, true); editing = ''; draw() },
  }, [m === 'outline' ? S_.modeOutline : S_.modeText])))

  const participants = (d: CoDoc): HTMLElement => {
    const others = d.people.filter((p) => p.did !== c.me().did)
    const names = others.map((p) => {
      const person = people().find((x) => c.h.didOf(x.id) === p.did)
      return person
        ? el('button', { class: 'co-chip', 'data-co-chip': p.did, onclick: () => c.h.openPerson(person.id) }, [p.name])
        : el('span', { class: 'co-chip-plain' }, [p.name])
    })
    const free = people().filter((p) => c.h.didOf(p.id) && !d.people.some((q) => q.did === c.h.didOf(p.id)))
    const picker = adding
      ? chipInput({
        placeholder: S_.addPeoplePh, aria: S_.addPeople, attrs: { 'data-co-people-input': '' },
        hits: (t) => matchPeople(free, t).map((p) => ({ label: p.name, attrs: { 'data-co-add': p.id }, pick: () => { c.put({ ...doc(), people: [...doc().people, { did: c.h.didOf(p.id) ?? '', name: p.name }] }); adding = false; draw() } })),
      })
      : null
    return el('div', { class: 'co-people', 'data-co-people': '' }, [
      el('span', { class: 'meta' }, [`${S_.people}: `]), ...(names.length ? names : [el('span', { class: 'meta' }, [S_.onlyYou])]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-co-add-people': '', onclick: () => { adding = !adding; draw(); root.querySelector<HTMLInputElement>('[data-co-people-input]')?.focus() } }, [S_.addPeople]),
      picker ? el('div', {}, [picker.input, picker.hits]) : null,
      adding && !free.length ? el('p', { class: 'meta' }, [S_.addPeopleNone]) : null,
    ])
  }

  /** "Combine with my AI": only the shared lines go to the owner's own endpoint; the answer lands as one AI-made block. */
  const combineRow = (): HTMLElement => {
    const btn = el('button', { class: 'btn btn-ghost btn-sm', 'data-co-combine': '', onclick: async () => {
      const ai = c.h.state().advanced?.ai
      if (!configured(ai)) { c.h.toast(D_.noAi); return }
      commit()
      btn.textContent = D_.combining
      try {
        const out = await combine(doc(), c.me(), ai, undefined, Date.now())
        if (out) { c.put(out); c.log(`Combined "${doc().title}" with my AI (${ai.model})`) } else c.h.toast(D_.nothingShared)
      } catch (e) { c.h.toast(D_.combineFailed(e instanceof Error ? e.message : String(e))) }
      draw()
    } }, [D_.combine])
    return el('div', {}, [btn, el('p', { class: 'meta' }, [D_.combineHint])])
  }

  const presence = (d: CoDoc): HTMLElement | null => {
    const last = Object.entries(d.seen ?? {}).filter(([did]) => did !== c.me().did).sort((a, b) => b[1] - a[1])[0]
    return last ? el('p', { class: 'meta', 'data-co-presence': '' }, [S_.edited(d.people.find((p) => p.did === last[0])?.name ?? '?', Math.max(0, Math.round((Date.now() - last[1]) / 60_000)))]) : null
  }

  /** The "…" page: the Logseq link, copy as Logseq, import from Logseq. A page of its own (Back returns here), not a sheet: closing a sheet would close this page too. */
  const morePage = (): void => {
    commit()
    const box = el('div', { class: 'co-more-page' })
    const fill = (): void => {
      const d = doc()
      const link = el('input', { class: 'field', value: d.logseq ? logseqUrl(d.logseq) : '', placeholder: S_.logseqPh, 'aria-label': S_.logseqLabel, 'data-co-logseq': '' }) as HTMLInputElement
      const paste = el('textarea', { class: 'field', rows: '5', placeholder: S_.importPh, 'aria-label': S_.importLogseq, 'data-co-import': '' }) as HTMLTextAreaElement
      box.replaceChildren(
        el('label', { class: 'eyebrow' }, [S_.logseqLabel]), link,
        el('div', { class: 'co-sheet-row' }, [
          el('button', { class: 'btn btn-ghost btn-sm', 'data-co-logseq-save': '', onclick: () => {
            const ref = parseLogseqRef(link.value)
            if (!ref && link.value.trim()) { c.h.toast(S_.logseqBad); return }
            c.put(setLogseq(doc(), ref ?? undefined, c.me()))
            c.h.toast(S_.logseqLinked)
            fill()
          } }, [S_.logseqSave]),
          d.logseq ? el('a', { class: 'co-link', href: logseqUrl(d.logseq), 'data-co-open-logseq': '' }, [S_.openLogseq]) : null,
          el('button', { class: 'btn btn-ghost btn-sm', 'data-co-copy-logseq': '', onclick: () => { void navigator.clipboard.writeText(toLogseq(doc())).then(() => c.h.toast(S_.copied)) } }, [S_.copyLogseq]),
        ]),
        el('label', { class: 'eyebrow' }, [S_.importLogseq]), paste,
        el('button', { class: 'btn btn-ghost btn-sm', 'data-co-import-do': '', onclick: () => {
          const got = fromLogseq(paste.value)
          const cur = doc()
          const next = fromText(cur, [toText(cur), got.text].filter(Boolean).join('\n'), c.me(), Date.now())
          c.put(got.uuid && cur.logseq ? setLogseq(next, { ...cur.logseq, uuid: got.uuid }, c.me()) : next)
          c.h.toast(S_.imported)
          history.back()
          draw()
        } }, [S_.importDo]),
      )
    }
    fill()
    c.h.page(S_.moreTitle, [box], 'co-note-more')
  }

  function draw(): void {
    const d = doc()
    const title = el('input', { class: 'field co-title', value: d.title, maxlength: '120', placeholder: S_.titlePh, 'aria-label': S_.titlePh, 'data-co-title': '', onchange: (e: Event) => { c.put(setTitle(doc(), (e.target as HTMLInputElement).value, c.me())); const h2 = root.closest('.page-layer')?.querySelector('h2'); if (h2) h2.textContent = doc().title } })
    root.replaceChildren(
      title,
      el('p', { class: 'meta', 'data-co-honest': '' }, [S_.honest]), presence(d) ?? '',
      participants(d), evDoc() ? '' : modeButtons(d),
      d.mode === 'text' && !evDoc() ? plain(d) : outline(d),
      d.kind === 'desires' ? combineRow() : '',
      el('button', { class: 'btn btn-ghost btn-sm co-more', 'data-co-more': '', 'aria-label': S_.more, onclick: morePage }, ['…']),
    )
    const live = editing ? root.querySelector<HTMLInputElement>(`[data-co-input="${CSS.escape(editing)}"]`) : null
    live?.focus()
    live?.setSelectionRange(live.value.length, live.value.length)
  }

  // Others' changes arrive by the relay: while this page is on screen, look every 10 s and show what merged without losing the cursor.
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return }
    void c.poll().then((changed) => {
      if (!changed || !root.isConnected) return
      const f = field()
      const at = f?.selectionStart ?? null
      commit()
      draw()
      const g = field()
      if (g && at !== null) { g.focus(); g.setSelectionRange(at, at) }
    })
  }, POLL_MS)

  draw()
  return root
}
