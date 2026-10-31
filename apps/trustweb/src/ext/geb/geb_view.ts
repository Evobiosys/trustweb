// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-geb): Geb as an extended messenger: setup page, the Chat screen's Geb part, a conversation page. DOM only. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import { threadRows } from '../../messenger_host_view'
import type { ExtHooks, MessengerSource } from '../registry'
import { bridgeCall, clearPairing, consumePairingHash, loadPairing, parsePairingHash, savePairing, toThreadSummaries, type Pairing } from './bridge_client'

export const GEB_APP = 'https://app.consensu.al'

const link = (href: string, text: string, mark: string): HTMLElement =>
  el('a', { class: 'btn btn-ghost btn-sm', href, target: '_blank', rel: 'noopener', 'data-geb-open': mark }, [text])

/** Explanations under one collapsed control, never in the way of the steps. */
function moreInfo(): HTMLElement {
  return el('details', { class: 'info-hint', 'data-geb-info': '' }, [el('summary', {}, [S.geb.info]), ...S.geb.infoText.map((t) => el('p', { class: 'meta' }, [t]))])
}

export function createGeb(h: ExtHooks): MessengerSource {
  const store = localStorage
  // The pairing link was opened in this browser: read its fragment once, keep port + token here only, drop it from the address bar.
  if (consumePairingHash(location, store, (u) => history.replaceState(history.state, '', u))) setTimeout(() => { h.toast(S.geb.paired); h.redraw() }, 0)

  const pair = (): Pairing | null => loadPairing(store)

  async function history_(p: Pairing, did: string) {
    const r = await bridgeCall(p, '/history?with=' + encodeURIComponent(did))
    return Array.isArray(r.lines) ? (r.lines as { from?: string; text?: string }[]) : []
  }

  async function send(threadId: string, text: string): Promise<boolean> {
    const p = pair()
    if (!p || !text.trim()) return false
    try {
      await bridgeCall(p, '/send', { to: threadId, text })
      return true
    } catch {
      return false
    }
  }

  function setup(): void {
    const copyBtn = el('button', { class: 'btn btn-ghost btn-sm', 'data-geb-copy': '', onclick: () => { void navigator.clipboard?.writeText(S.geb.bridgeCmd).then(() => h.toast(S.geb.copied), () => h.toast(S.geb.bridgeCmd)) } }, [S.geb.copy])
    const paste = el('input', { class: 'field', placeholder: S.geb.pastePh, 'aria-label': S.geb.pastePh, 'data-geb-paste': '' })
    const connect = el('button', { class: 'btn btn-sm', 'data-geb-connect': '', onclick: () => {
      const hash = paste.value.includes('#') ? paste.value.slice(paste.value.indexOf('#')).trim() : ''
      const got = parsePairingHash(hash)
      if (!got) { h.toast(S.geb.badLink); return }
      savePairing(store, got)
      h.toast(S.geb.paired)
      history.back()
      h.redraw()
    } }, [S.geb.connect])
    h.page(S.geb.setupTitle, [
      el('ol', { class: 'steps', 'data-geb-steps': '' }, [
        el('li', {}, [S.geb.step1, ' ', link(GEB_APP, S.geb.openGeb, 'install')]),
        el('li', {}, [S.geb.step2, el('pre', { class: 'meta' }, [S.geb.bridgeCmd]), copyBtn]),
        el('li', {}, [S.geb.step3, el('div', {}, [paste, connect])]),
      ]),
      moreInfo(),
      el('button', { class: 'btn btn-ghost', 'data-geb-notnow': '', onclick: () => history.back() }, [S.geb.notNow]),
    ], 'geb-setup')
  }

  function open(threadId: string): void {
    const p = pair()
    const name = toThreadSummaries([{ did: threadId }], h.state().people)[0]?.title ?? threadId.slice(0, 12)
    const list = el('div', { class: 'geb-lines', 'data-geb-lines': '' }, [el('p', { class: 'meta' }, [S.geb.historyLoading])])
    const load = (): void => {
      if (!p) { list.replaceChildren(el('p', { class: 'empty' }, [S.msgUnreachable(S.geb.label)])); return }
      history_(p, threadId).then(
        (ls) => list.replaceChildren(...(ls.length ? ls.map((l) => el('p', { class: 'geb-line' }, [(l.from === 'me' ? '› ' : '') + (l.text ?? '')])) : [el('p', { class: 'meta' }, [S.geb.historyEmpty])])),
        () => list.replaceChildren(el('p', { class: 'empty' }, [S.msgUnreachable(S.geb.label)]), el('p', { class: 'meta' }, [S.geb.startBridge])),
      )
    }
    const box = el('textarea', { class: 'field', rows: 2, placeholder: S.geb.boxPh, 'aria-label': S.geb.boxPh, 'data-geb-box': '' })
    const btn = el('button', { class: 'btn', 'data-geb-send': '', onclick: () => {
      const text = box.value
      void send(threadId, text).then((ok) => {
        h.toast(ok ? S.geb.sent : S.geb.sendFailed)
        if (ok) { box.value = ''; load() }
      })
    } }, [S.geb.send])
    h.page(S.geb.historyTitle(name), [list, box, btn, el('p', { class: 'meta', 'data-geb-sendhint': '' }, [S.geb.sendHint])], 'geb-thread')
    load()
  }

  function view(): Node[] {
    const p = pair()
    const list = el('div', { class: 'ppl', 'data-geb-threads': '' }, [el('p', { class: 'meta' }, [S.msgLoading])])
    const note = el('p', { class: 'meta', 'data-geb-note': '', hidden: true }, [S.geb.startBridge])
    const out: Node[] = [
      el('div', { class: 'msg-setup', 'data-geb-bar': '' }, [
        link(GEB_APP, S.geb.openGeb, 'app'),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-geb-unpair': '', onclick: () => { clearPairing(store); h.toast(S.geb.unpaired); h.redraw() } }, [S.geb.unpair]),
      ]),
      el('p', { class: 'meta' }, [S.geb.openGebHint]),
      note,
      list,
    ]
    if (!p) { list.replaceChildren(); return out }
    void threads().then(
      (ts) => list.replaceChildren(...threadRows(src, ts, Date.now())),
      () => { list.replaceChildren(el('p', { class: 'empty' }, [S.msgUnreachable(S.geb.label)])); note.hidden = false },
    )
    return out
  }

  async function threads() {
    const p = pair()
    if (!p) return []
    const r = await bridgeCall(p, '/threads')
    return toThreadSummaries(r.threads, h.state().people)
  }

  const src: MessengerSource = {
    id: 'geb',
    label: S.geb.label,
    icon: '',
    status: () => (pair() ? 'live' : 'needs-setup'),
    threads,
    open,
    send,
    setup,
    view,
  }
  return src
}
