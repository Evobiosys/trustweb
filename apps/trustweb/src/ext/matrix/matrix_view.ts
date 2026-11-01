// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Matrix module (wave 27, msg-matrix): the messenger source, the one setup page and the read-only room page. DOM + localStorage. */
import { el } from '../../../../demo/src/ui/dom'
import { ICONS } from '../../icons'
import { browserOpenEnv, openLocalFirst } from '../../messenger_links'
import { setSourceOff } from '../../messenger_combined_view'
import { S } from '../../strings'
import type { ExtHooks, MessengerSource, ThreadSummary } from '../registry'
import { DEFAULT_HOMESERVER, ELEMENT_LINK, elementXUri, loginTokenFrom, normalizeHomeserver, parseMessages, parseSession, parseSync, pickLogin, ssoRedirectUrl, type MatrixSession } from './matrix'
import { createClient } from './matrix_io'

const SESSION_KEY = 'trustweb.matrix.session'
const PENDING_KEY = 'trustweb.matrix.sso-hs'
const READ_HERE_KEY = 'trustweb.matrix.read-here'
/** Where Element X is installed from, for servers whose login TrustWeb can't do. */
const ELEMENT_X_LINK = 'https://element.io/download'

const T = S.matrix
const client = createClient((url, init) => fetch(url, init))

const loadSession = (): MatrixSession | null => parseSession(localStorage.getItem(SESSION_KEY))
const keepSession = (s: MatrixSession): void => localStorage.setItem(SESSION_KEY, JSON.stringify(s))

function info(text: string, label: string): Node[] {
  const hint = el('p', { class: 'info-hint', hidden: true }, [text])
  const btn = el('button', { class: 'info', type: 'button', 'aria-label': label, onclick: (e: Event) => { e.preventDefault(); hint.hidden = !hint.hidden } })
  btn.innerHTML = ICONS.info
  return [btn, hint]
}

/** The code Element X takes (a matrix: address), readable and one tap to copy, for when the button cannot open the app. */
function codeField(target: string, toast: (m: string) => void): HTMLElement {
  const box = el('input', { class: 'field', readonly: '', value: elementXUri(target), 'aria-label': T.code, 'data-matrix-code': '' }) as HTMLInputElement
  return el('div', { class: 'row' }, [box, el('button', { class: 'btn btn-ghost btn-sm', 'data-matrix-copy': '', onclick: () => { void navigator.clipboard?.writeText(box.value).then(() => toast(T.copied), () => { box.select(); toast(box.value) }) } }, [T.copy])])
}

export function matrixMessenger(h: ExtHooks): MessengerSource {
  let cache: ThreadSummary[] = []

  /** Back from the SSO page: ?loginToken=... plus the server we sent them to. */
  const token = loginTokenFrom(h.boot.search)
  const pendingHs = localStorage.getItem(PENDING_KEY)
  if (token && pendingHs) {
    localStorage.removeItem(PENDING_KEY)
    const u = new URL(location.href); u.searchParams.delete('loginToken')
    history.replaceState(history.state, '', u.pathname + u.search + u.hash)
    void client.loginToken(pendingHs, token).then((s) => { keepSession(s); h.redraw() }, () => h.toast(T.signInFailed))
  }

  const readRoom = (s: MatrixSession, id: string): void => {
    const list = el('div', { class: 'msg-room', 'data-matrix-room': '' }, [el('p', { class: 'meta' }, [S.msgLoading])])
    const title = cache.find((t) => t.id === id)?.title ?? T.roomTitle
    h.page(title, [
      el('div', { class: 'scroll' }, [
        el('p', { class: 'meta' }, [el('a', { href: ELEMENT_LINK(id), target: '_blank', rel: 'noopener', 'data-matrix-open-element': '', onclick: (e: Event) => { e.preventDefault(); openElementX(id) } }, [T.openElement]), ...info(T.roomHint, T.roomInfo)]),
        el('p', { class: 'meta' }, [T.code, ...info(T.codeHint, T.code)]),
        codeField(id, h.toast),
        list,
      ]),
    ], 'matrix-room')
    void client.messages(s, id).then((body) => {
      const ms = parseMessages(body)
      list.replaceChildren(...(ms.length ? ms.map((m) => el('p', { class: 'msg-line', 'data-matrix-msg': m.id }, [
        el('b', {}, [m.sender + ' ']), m.encrypted ? el('i', {}, [T.encrypted]) : m.text,
      ])) : [el('p', { class: 'empty' }, [T.noText])]))
    }, () => list.replaceChildren(el('p', { class: 'empty' }, [S.msgUnreachable(T.label)])))
  }

  const openElementX = (id: string): void => openLocalFirst(elementXUri(id), ELEMENT_LINK(id), browserOpenEnv())

  const setup = (): void => {
    const hsField = el('input', { class: 'field', value: DEFAULT_HOMESERVER, 'aria-label': T.server, autocomplete: 'off', inputmode: 'url', 'data-matrix-server': '' }) as HTMLInputElement
    const out = el('div', { 'data-matrix-signin': '' })
    const note = el('p', { class: 'meta', role: 'status', 'data-matrix-note': '' })
    const finish = (s: MatrixSession): void => { keepSession(s); history.back(); h.redraw() }
    const check = async (): Promise<void> => {
      const typed = normalizeHomeserver(hsField.value)
      if (!typed) { note.textContent = T.badServer; return }
      note.textContent = T.checking
      out.replaceChildren()
      try {
        const hs = await client.discover(typed)
        const flows = pickLogin(await client.flows(hs))
        note.textContent = ''
        if (flows.none) {
          out.append(el('p', {}, [T.unsupported + ' ', el('a', { href: ELEMENT_X_LINK, target: '_blank', rel: 'noopener', 'data-matrix-element-x': '' }, [T.elementX])]))
          return
        }
        out.append(el('b', {}, [T.step2]))
        if (flows.password) {
          const user = el('input', { class: 'field', 'aria-label': T.user, autocomplete: 'username', autocapitalize: 'none', 'data-matrix-user': '' }) as HTMLInputElement
          const pw = el('input', { class: 'field', type: 'password', 'aria-label': T.password, autocomplete: 'current-password', 'data-matrix-password': '' }) as HTMLInputElement
          out.append(user, pw, el('button', { class: 'btn', 'data-matrix-login': '', onclick: () => {
            note.textContent = T.checking
            void client.loginPassword(hs, user.value.trim(), pw.value).then(finish, () => { note.textContent = T.signInFailed })
          } }, [T.signIn]))
        }
        if (flows.sso) {
          out.append(el('button', { class: 'btn', 'data-matrix-sso': '', onclick: () => {
            localStorage.setItem(PENDING_KEY, hs)
            location.href = ssoRedirectUrl(hs, location.origin + location.pathname)
          } }, [T.signInSso]))
        }
      } catch { note.textContent = T.unreachable }
    }
    h.page(T.setupTitle, [
      el('div', { class: 'scroll', 'data-matrix-setup': '' }, [
        el('b', {}, [T.step1]),
        el('p', {}, [T.server, ...info(T.serverHint, T.serverInfo)]),
        hsField,
        el('button', { class: 'btn', 'data-matrix-check': '', onclick: () => void check() }, [T.check]),
        note,
        out,
        el('p', {}, [el('b', {}, [T.step3]), ...info(T.privacy, T.privacyInfo)]),
        el('button', { class: 'btn btn-ghost', 'data-matrix-notnow': '', onclick: () => history.back() }, [T.notNow]),
      ]),
    ], 'matrix-setup')
  }

  const open = (id: string): void => {
    const s = loadSession()
    if (s && localStorage.getItem(READ_HERE_KEY) === '1') readRoom(s, id)
    else openElementX(id)
  }

  return {
    id: 'matrix',
    label: T.label,
    icon: ICONS.chat,
    status: () => (loadSession() ? 'live' : 'needs-setup'),
    threads: async () => {
      const s = loadSession()
      if (!s) return []
      cache = parseSync(await client.sync(s), h.state().people)
      return cache
    },
    open,
    setup,
    extra: () => {
      const s = loadSession()
      const readHere = el('input', { type: 'checkbox', 'data-matrix-read-here': '' }) as HTMLInputElement
      readHere.checked = localStorage.getItem(READ_HERE_KEY) === '1'
      readHere.addEventListener('change', () => { if (readHere.checked) localStorage.setItem(READ_HERE_KEY, '1'); else localStorage.removeItem(READ_HERE_KEY) })
      return [
        el('details', { class: 'meta', 'data-matrix-account': '' }, [
          el('summary', {}, [T.account]),
          el('p', {}, [T.signedIn(s?.userId ?? '')]),
          el('label', {}, [readHere, ' ' + T.readHere]),
          el('p', {}, [T.roomHint]),
          s?.userId ? codeField('@' + s.userId.replace(/^@/, ''), h.toast) : null,
          el('button', { class: 'btn btn-ghost btn-sm', 'data-matrix-off': '', onclick: () => { setSourceOff('matrix', true); h.redraw() } }, [T.switchOff]),
          el('button', { class: 'btn btn-ghost btn-sm', 'data-matrix-logout': '', onclick: () => {
            const cur = loadSession()
            localStorage.removeItem(SESSION_KEY)
            if (cur) void client.logout(cur).catch(() => undefined)
            h.toast(T.signedOut); h.redraw()
          } }, [T.signOut]),
        ]),
      ]
    },
  }
}
