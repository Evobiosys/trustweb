/**
 * Settings: the tappable link (trustweb.one/<name>) opens a sheet to change the MAIN name; an "Are you sure?" step says what changes
 * before anything is sent (link_change.ts holds the rules). Words in strings.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { ClaimError } from './connect_code'
import { LinkChange, changePrimaryName } from './link_change'
import type { NamesOutcome, NamesState } from './names_sync'
import { S } from './strings'

export interface LinkChangeViewHooks {
  names: () => NamesState
  claim: (name: string) => Promise<NamesOutcome>
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  /** Back to Settings after a change or a cancel. */
  settings: () => void
}

/** The underlined link text; null until a main name is held. */
export function linkButton(name: string, onTap: () => void): HTMLElement | null {
  return name ? el('button', { class: 'link-name', type: 'button', 'data-change-link': '1', 'aria-label': S.unLinkTap, onclick: onTap }, [`trustweb.one/${name}`]) : null
}

export function openLinkChange(h: LinkChangeViewHooks): void {
  const held = h.names().name
  const input = el('input', { class: 'field', placeholder: S.usernamePh, 'aria-label': S.usernameLabel, maxlength: '30', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-new-link': '1' })
  const status = el('p', { class: 'meta', role: 'status', 'data-link-status': '' })
  const confirmSheet = (from: string, to: string): Promise<boolean> => new Promise((resolve) => {
    const answer = (yes: boolean): void => { if (!yes) openLinkChange(h); resolve(yes) }
    h.openSheet([
      el('h3', {}, [S.unLinkTitle]),
      el('p', { 'data-link-sure': '1' }, [S.unLinkSure(from, to)]),
      el('button', { class: 'btn btn-electric', 'data-link-yes': '1', onclick: () => answer(true) }, [S.unLinkYes]),
      el('button', { class: 'btn btn-ghost', 'data-link-no': '1', onclick: () => answer(false) }, [S.unLinkNo]),
    ])
  })
  const go = async (): Promise<void> => {
    const r = await changePrimaryName({ names: h.names(), raw: input.value, confirm: confirmSheet, claim: h.claim })
    switch (r.kind) {
      case LinkChange.Done: h.toast(S.unLinkDone(r.names.name)); h.settings(); break
      case LinkChange.Cancelled: break
      case LinkChange.Same: status.textContent = S.unLinkSame; break
      case LinkChange.Bad: status.textContent = S.usernameFailed[ClaimError.BadName]; break
      case LinkChange.Locked: status.textContent = S.usernameFailed[ClaimError.NameLocked]; break
      case LinkChange.Refused: openLinkChange(h); h.toast(S.usernameFailed[r.error]); break
    }
  }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void go() })
  h.openSheet([
    el('h3', {}, [S.unLinkTitle]),
    el('p', { class: 'meta' }, [held ? S.unLinkLead(held) : S.unLinkLeadNone]),
    input, status,
    el('button', { class: 'btn btn-electric', 'data-link-go': '1', onclick: () => void go() }, [S.unLinkGo]),
    el('button', { class: 'btn btn-ghost', onclick: h.settings }, [S.unLinkNo]),
  ])
}
