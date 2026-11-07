// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Settings > My channels: per own address / messenger, the reader chip (humans -> private AIs -> all AIs) and the provider sheet. */
import { el } from '../../demo/src/ui/dom'
import { AI_PROVIDERS, mayRead, nextReaders, ownChannels, setProvider, type OwnChannel } from './channel_readers'
import { isEmailAddress } from './channel'
import type { AppState } from './model'
import { S } from './strings'

export interface ReadersHooks {
  state: () => AppState
  save: () => void
  redraw: () => void
  openSheet: (children: Node[]) => void
  toast: (msg: string) => void
}

export function readersBlock(h: ReadersHooks): HTMLElement {
  const s = h.state()
  const update = (id: string, patch: Partial<NonNullable<AppState['channelReaders']>[string]>, redraw = true): void => {
    (s.channelReaders ??= {})[id] = { ...s.channelReaders[id], ...patch }
    h.save()
    if (redraw) h.redraw()
  }
  const sheet = (c: OwnChannel): void => h.openSheet([
    el('h3', {}, [c.value]),
    el('p', { class: 'meta' }, [S.readersSheetHint]),
    ...AI_PROVIDERS.map((p) => {
      const box = el('input', { type: 'checkbox', 'data-readers-provider': p, disabled: c.readers === 'humans' }) as HTMLInputElement
      box.checked = mayRead(c, { kind: 'ai', provider: p })
      box.addEventListener('change', () => update(c.id, setProvider(c, p, box.checked), false))
      return el('label', { class: 'readers-provider' }, [box, ' ', S.readersProvider[p]])
    }),
  ])
  const row = (c: OwnChannel): HTMLElement => el('div', { class: 'conn-row readers-row', 'data-readers-row': c.id }, [
    el('span', {}, [c.value, ...(c.id === `email:${s.me.primaryEmail?.address}` ? [' ', el('small', {}, [`(${S.readersPersonal})`])] : [])]),
    el('button', { class: 'link-btn', type: 'button', 'data-readers': c.readers, onclick: () => update(c.id, { readers: nextReaders(c.readers) }) }, [S.readersLabel[c.readers]]),
    el('button', { class: 'link-btn', type: 'button', 'data-readers-more': '1', 'aria-label': S.readersMoreAria(c.value), onclick: () => sheet(c) }, ['…']),
  ])
  const add = el('input', { class: 'field', type: 'email', 'aria-label': S.readersAddEmail, placeholder: S.readersAddEmail, 'data-readers-email': '1' }) as HTMLInputElement
  const addEmail = (): void => {
    const a = add.value.trim().toLowerCase()
    if (!isEmailAddress(a)) { h.toast(S.readersBadEmail); return }
    if (a !== s.me.primaryEmail?.address && !s.me.otherEmails?.includes(a)) (s.me.otherEmails ??= []).push(a)
    h.save(); h.redraw()
  }
  const own = ownChannels(s)
  return el('div', { class: 'channels readers', 'data-readers-block': '1' }, [
    el('h4', { class: 'eyebrow' }, [S.readersTitle]),
    el('p', { class: 'meta' }, [S.readersHint]),
    ...(own.length ? own.map(row) : [el('p', { class: 'meta' }, [S.readersNone])]),
    add,
    el('button', { class: 'link-btn', type: 'button', 'data-readers-email-add': '1', onclick: addEmail }, [S.readersAddEmailSave]),
  ])
}
