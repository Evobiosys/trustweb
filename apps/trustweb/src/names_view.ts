/**
 * "Your username" in Meet > Advanced (wave 6e): the main name and ONE more name, each with Claim and Release, plus any further name the
 * code holds (two aliases at most) with its own Release. A locked name (granted by the operator; names_sync.ts) shows a lock mark and no
 * Release and cannot be replaced from here. DOM and words only: what the server answers is names_sync.ts, the sentences are strings.ts.
 *
 * Built once and updated in place (update()), so a redraw of Advanced or an answer from the server never clears what is being typed.
 */
import { el } from '../../demo/src/ui/dom'
import { cleanName, isLocked } from './names_sync'
import type { NamesOutcome, NamesState } from './names_sync'
import { S } from './strings'

export interface NamesViewOptions {
  names: () => NamesState
  claim: (name: string, alias: boolean) => Promise<NamesOutcome>
  release: (name: string) => Promise<NamesOutcome>
}

export interface NamesView {
  el: HTMLElement
  /** Redraws what is held (after a READ, a claim or a release); a field being typed in keeps its text. */
  update(): void
}

interface Slot {
  root: HTMLElement
  input: HTMLInputElement
  held: HTMLElement
  claim: HTMLButtonElement
  release: HTMLButtonElement
  /** What the input showed when it was last set from the server: a field the person has not touched follows the server. */
  shown: string
}

export function createNamesView(o: NamesViewOptions): NamesView {
  const status = el('p', { class: 'meta', role: 'status', 'data-username-status': '' })
  const more = el('div', { class: 'names-more', 'data-names-more': '' })

  const slot = (alias: boolean): Slot => {
    const input = el('input', {
      class: 'field', maxlength: '30', placeholder: S.usernamePh, 'aria-label': alias ? S.usernameAliasLabel : S.usernameLabel,
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...(alias ? { 'data-alias': '' } : { 'data-username': '' }),
    })
    const held = el('p', { class: 'meta name-held', 'data-name-held': alias ? 'alias' : 'primary' })
    const claim = el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': alias ? 'claim-alias' : 'claim-name',
      onclick: () => void run(() => o.claim(cleanName(input.value), alias), alias),
    }, [alias ? S.usernameClaimAlias : S.usernameClaim])
    const release = el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': alias ? 'release-alias' : 'release-name',
      onclick: () => { const n = heldOf(alias); if (n) void run(() => o.release(n), alias) },
    }, [S.usernameRelease])
    const root = el('div', { class: 'username-row', 'data-username-row': alias ? 'alias' : 'primary' }, [
      el('h4', { class: 'eyebrow' }, [alias ? S.usernameAliasLabel : S.usernameLabel]),
      held, input, el('div', { class: 'row-actions' }, [claim, release]),
    ])
    return { root, input, held, claim, release, shown: '' }
  }
  const primary = slot(false)
  const alias = slot(true)

  const heldOf = (isAlias: boolean): string => {
    const n = o.names()
    return isAlias ? n.aliases[0] ?? '' : n.name
  }

  /** The words for an outcome; the held names are redrawn either way (a refusal can teach that a name is locked). */
  async function run(call: () => Promise<NamesOutcome>, isAlias: boolean): Promise<void> {
    const out = await call()
    if (!out.ok) { status.textContent = S.usernameFailed[out.error]; update(); return }
    const now = isAlias ? out.names.aliases[0] ?? '' : out.names.name
    status.textContent = now ? S.usernameHeld(now) : S.usernameReleased
    update()
  }

  /**
   * Draws one slot. The main name can be replaced by claiming another (the server frees the old one); a second name is added, never
   * replaced, so while one is held the slot shows it with Release only. A locked name has no field and no buttons, only the lock mark.
   */
  const paint = (s: Slot, value: string, locked: boolean, replaceable: boolean): void => {
    if (s.input.value === s.shown && document.activeElement !== s.input) s.input.value = replaceable ? value : ''
    s.shown = replaceable ? value : ''
    s.held.textContent = value ? (locked ? `@${value}  ·  ${S.usernameLockedMark}` : S.usernameHeld(value)) : ''
    s.held.toggleAttribute('data-locked', locked)
    s.held.hidden = !value
    const editable = !locked && (replaceable || !value)
    s.input.hidden = !editable
    s.claim.hidden = !editable
    s.release.hidden = locked || !value
    s.root.setAttribute('data-state', locked ? 'locked' : value ? 'held' : 'free')
  }

  function update(): void {
    const n = o.names()
    paint(primary, n.name, !!n.name && isLocked(n, n.name), true)
    const first = n.aliases[0] ?? ''
    paint(alias, first, !!first && isLocked(n, first), false)
    more.replaceChildren(...n.aliases.slice(1).map((name) => el('div', { class: 'name-extra', 'data-name-extra': name }, [
      el('span', { class: 'meta' }, [isLocked(n, name) ? `@${name}  ·  ${S.usernameLockedMark}` : `${S.usernameMoreLabel}: @${name}`]),
      isLocked(n, name) ? null : el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'release-extra', onclick: () => void run(() => o.release(name), true),
      }, [S.usernameRelease]),
    ])))
  }

  const root = el('div', { class: 'names-view', 'data-names': '' }, [
    primary.root, alias.root, more, status, el('p', { class: 'meta' }, [S.usernameHint]),
  ])
  update()
  return { el: root, update }
}
