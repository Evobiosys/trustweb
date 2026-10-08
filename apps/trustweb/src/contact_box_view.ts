/**
 * The contact box (wave 6e, owner 2026-10-08: "let it just be the Signal link, and then let people also, in the same box, add the
 * WhatsApp link"): ONE box for Signal, WhatsApp and Matrix, each with its own "share when we connect" tick. It sits in Meet > Advanced
 * and in Settings; both draw it from here, so they cannot drift apart. No Signal/Molly choice any more.
 *
 * DOM and words only: what a value must look like is channel.ts, what is saved and ticked is the hook's (main.ts) business. Typing in a
 * row survives a refresh of the ticks; saving an empty row removes the link.
 */
import { el } from '../../demo/src/ui/dom'
import { Channel } from './model'
import type { ChannelMap } from './contact_share'
import { S } from './strings'
import { ICONS } from './icons'

/** The channels of the box, in this order. */
export const BOX_CHANNELS: readonly Channel[] = [Channel.Signal, Channel.WhatsApp, Channel.Matrix]

export interface ContactBoxOptions {
  /** What is saved now. */
  mine: () => ChannelMap
  /** A valid, normalised value to keep ('' never reaches this). */
  save: (channel: Channel, value: string) => void
  remove: (channel: Channel) => void
  /** channel.ts normalizeHandle: null when the text is no handle of this channel. */
  normalize: (channel: Channel, raw: string) => string | null
  /** The tick (and its phone-number warning) under a saved link: chat_view.ts renderShareControls. */
  ticks: (channel: Channel) => HTMLElement
  /** A value was saved or removed. */
  changed?: (channel: Channel) => void
}

export interface ContactBox {
  el: HTMLElement
  /** Redraws the ticks only (a tick was changed elsewhere); a row being typed in stays as it is. */
  refreshTicks(): void
  /** Opens one row for typing (saved or not) and focuses it. */
  edit(channel: Channel): void
}

/** A channel's name in the box; Signal carries its glyph (wave 6h, S3: "include the signal icon to make it easier visible"). */
function channelName(ch: Channel): HTMLElement {
  const name = el('span', { class: 'ch-name ch-' + ch }, [S.chLabel[ch]])
  if (ch !== Channel.Signal) return name
  const glyph = el('span', { class: 'ch-glyph', 'aria-hidden': 'true' })
  glyph.innerHTML = ICONS.signal
  name.prepend(glyph)
  return name
}

export function createContactBox(o: ContactBoxOptions): ContactBox {
  let editing: Channel | null = null
  const rows = new Map<Channel, HTMLElement>()
  const tickSlots = new Map<Channel, HTMLElement>()
  const root = el('div', { class: 'contact-box', 'data-contact-box': '' })

  const finish = (ch: Channel): void => { editing = null; drawRow(ch); o.changed?.(ch) }

  const editorRow = (ch: Channel, value: string | undefined): HTMLElement => {
    const input = el('input', { class: 'field', placeholder: S.chPh[ch], value: value ?? '', 'aria-label': S.chPh[ch], autocomplete: 'off', 'data-cb-input': ch })
    const msg = el('p', { class: 'meta ch-msg', role: 'status', 'data-cb-msg': ch })
    const saveIt = (): void => {
      if (!input.value.trim()) { if (value) o.remove(ch); finish(ch); return }
      const v = o.normalize(ch, input.value)
      if (!v) { msg.textContent = S.chInvalid[ch]; input.focus(); return }
      o.save(ch, v)
      finish(ch)
    }
    input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') saveIt() })
    setTimeout(() => input.focus(), 0)
    return el('div', { class: 'cb-row editing', 'data-cb-row': ch }, [
      channelName(ch), input, msg,
      el('div', { class: 'rec-saves' }, [
        el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-cb-save': ch, onclick: saveIt }, [S.chSave]),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { editing = null; drawRow(ch) } }, [S.chCancel]),
      ]),
    ])
  }

  const savedRow = (ch: Channel, value: string): HTMLElement => {
    const slot = el('div', { class: 'cb-ticks', 'data-cb-ticks': ch }, [o.ticks(ch)])
    tickSlots.set(ch, slot)
    return el('div', { class: 'cb-row', 'data-cb-row': ch }, [
      channelName(ch),
      el('code', { class: 'cb-value', 'data-cb-value': ch }, [value]),
      el('button', { class: 'mini', type: 'button', 'data-cb-edit': ch, 'aria-label': S.chEdit(S.chLabel[ch]), onclick: () => edit(ch) }, [S.chEditShort]),
      slot,
    ])
  }

  const emptyRow = (ch: Channel): HTMLElement => el('div', { class: 'cb-row', 'data-cb-row': ch }, [
    channelName(ch),
    el('button', { class: 'mini', type: 'button', 'data-cb-add': ch, onclick: () => edit(ch) }, ['+ ' + S.chAdd]),
  ])

  function drawRow(ch: Channel): void {
    const value = o.mine()[ch]
    tickSlots.delete(ch)
    const next = editing === ch ? editorRow(ch, value) : value ? savedRow(ch, value) : emptyRow(ch)
    const old = rows.get(ch)
    if (old) old.replaceWith(next)
    rows.set(ch, next)
  }

  function edit(ch: Channel): void {
    const before = editing
    editing = ch
    if (before && before !== ch) drawRow(before)
    drawRow(ch)
  }

  for (const ch of BOX_CHANNELS) {
    const row = o.mine()[ch] ? savedRow(ch, o.mine()[ch] as string) : emptyRow(ch)
    rows.set(ch, row)
  }
  root.append(el('h4', { class: 'eyebrow' }, [S.contactBoxTitle]), ...rows.values(), el('p', { class: 'meta' }, [S.contactBoxHint]))

  return {
    el: root,
    edit,
    refreshTicks(): void {
      for (const [ch, slot] of tickSlots) slot.replaceChildren(o.ticks(ch))
    },
  }
}
