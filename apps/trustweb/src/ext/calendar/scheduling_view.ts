// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar scheduling view (wave 24, cal5): my availability sheet and link, the booking page, the owner's accept. Nothing leaves without a tap. */
import { el } from '../../../../demo/src/ui/dom'
import type { Availability } from '../../model'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'
import { acceptBooking, decodeBookLink, decodeBookedLink, encodeBookLink, encodeBookedLink, freeSlots, keepHeld, snapshot, type BookPayload, type BookedPayload } from './scheduling'

const HORIZON = 14
const SHOWN = 40
const DEFAULT_WINDOWS: Availability['windows'] = [0, 1, 2, 3, 4].map((day) => ({ day, from: '09:00', to: '17:00' }))
const dayLabel = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const timeLabel = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export function createScheduling(h: ExtHooks): { button: () => HTMLElement; openLink: (hash: string) => boolean } {
  /** Link text with Copy and Share (navigator.share when present). */
  function linkBox(link: string, attr: string, copied: string): HTMLElement {
    return el('div', {}, [
      el('input', { class: 'field', readonly: true, value: link, [attr]: '', 'aria-label': S.cal.bookedLinkLbl }),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-cal-copy': '', onclick: () => { void navigator.clipboard?.writeText(link); h.toast(copied) } }, [S.cal.copy]),
      typeof navigator.share === 'function' ? el('button', { class: 'btn btn-ghost btn-sm', 'data-cal-share': '', onclick: () => { void navigator.share({ url: link }).catch(() => undefined) } }, [S.cal.share]) : null,
    ])
  }

  function availabilitySheet(): void {
    const s = h.state()
    const saved = s.availability
    const win = (d: number): { from: string; to: string } | undefined => (saved ? saved.windows : DEFAULT_WINDOWS).find((w) => w.day === d)
    const rows = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const w = win(d)
      return el('div', { class: 'prow' }, [
        el('label', {}, [el('input', { type: 'checkbox', checked: Boolean(w), 'data-avail-on': String(d) }), ` ${S.cal.weekdays[d]} `]),
        el('input', { type: 'time', value: w?.from ?? '09:00', 'data-avail-from': String(d), 'aria-label': S.cal.availFrom }),
        el('input', { type: 'time', value: w?.to ?? '17:00', 'data-avail-to': String(d), 'aria-label': S.cal.availTo }),
      ])
    })
    const slot = el('select', { 'data-avail-slot': '', 'aria-label': S.cal.availSlot }, [30, 60].map((n) => el('option', { value: String(n), selected: (saved?.slotMin ?? 30) === n }, [S.cal.availMin(n)]))) as HTMLSelectElement
    const held = s.heldAvailability ?? []
    const ticks = held.map((x) => el('label', { class: 'meta' }, [
      el('input', { type: 'checkbox', 'data-avail-held': x.name }), ` ${x.name} `, el('i', {}, [S.cal.availHeldHint(x.name, new Date(x.at).toLocaleDateString())]),
    ]))
    const out = el('div', {})
    const read = (): Availability => {
      const q = (a: string, d: number): HTMLInputElement => sheetRoot.querySelector(`[data-avail-${a}="${d}"]`) as HTMLInputElement
      const windows = [0, 1, 2, 3, 4, 5, 6].filter((d) => q('on', d).checked && q('from', d).value && q('to', d).value > q('from', d).value).map((d) => ({ day: d, from: q('from', d).value, to: q('to', d).value }))
      return { windows, slotMin: Number(slot.value) as 30 | 60 }
    }
    const save = (): void => { s.availability = read(); h.save(); h.toast(S.cal.availSaved) }
    const makeLink = (): void => {
      const mine = snapshot(s, Date.now())
      if (!mine) { h.toast(S.cal.needAvail); return }
      const names = held.filter((x) => (sheetRoot.querySelector(`[data-avail-held="${x.name}"]`) as HTMLInputElement | null)?.checked)
      const me = h.me()
      const payload: BookPayload = { v: 1, owner: me, snaps: [mine, ...names.map((x) => x.snap)], id: h.newId() }
      const link = encodeBookLink(h.origin, payload)
      if (!decodeBookLink(new URL(link).hash)) { out.replaceChildren(el('p', { class: 'meta' }, [S.cal.linkTooBig])); return }
      s.bookLinks = [...(s.bookLinks ?? []), { id: payload.id, at: Date.now(), held: names.map((x) => x.name) }]
      h.save()
      out.replaceChildren(linkBox(link, 'data-book-link-text', S.cal.linkCopied))
    }
    const sheetRoot = el('div', { 'data-cal-availability-sheet': '' }, [
      el('h2', {}, [S.cal.availability]), el('p', { class: 'meta' }, [S.cal.availWindows]), ...rows,
      el('label', {}, [`${S.cal.availSlot} `, slot]),
      held.length ? el('div', {}, [el('h3', {}, [S.cal.availHeld]), ...ticks]) : null,
      el('p', { class: 'meta' }, [S.cal.availDeviceOnly]),
      el('button', { class: 'btn btn-electric wide', 'data-avail-save': '', onclick: save }, [S.cal.availSave]),
      el('button', { class: 'btn btn-ghost wide', 'data-cal-book-link': '', onclick: makeLink }, [S.cal.makeLink]),
      el('p', { class: 'meta' }, [S.cal.linkHint]), out,
    ])
    h.sheet([sheetRoot])
  }

  function bookingSheet(p: BookPayload): void {
    const [owner] = p.snaps
    const slots = freeSlots(p.snaps, Date.now(), HORIZON, owner.slotMin)
    let shown = SHOWN
    let picked: number | null = null
    const list = el('div', {})
    const out = el('div', {})
    const name = el('input', { class: 'field', value: h.me().name, placeholder: S.cal.bookYourName, 'data-book-name': '', 'aria-label': S.cal.bookYourName }) as HTMLInputElement
    const note = el('input', { class: 'field', placeholder: S.cal.bookNote, 'data-book-note': '', 'aria-label': S.cal.bookNote }) as HTMLInputElement
    const draw = (): void => {
      const rows: Node[] = []
      let chips: HTMLElement | null = null
      let day = ''
      for (const x of slots.slice(0, shown)) {
        if (dayLabel(x.s) !== day) { day = dayLabel(x.s); chips = el('div', { class: 'chips' }); rows.push(el('h3', {}, [day]), chips) }
        chips?.append(el('button', { class: 'btn btn-ghost btn-sm' + (picked === x.s ? ' on' : ''), 'data-book-slot': String(x.s), 'aria-pressed': String(picked === x.s), onclick: () => { picked = x.s; draw() } }, [timeLabel(x.s)]))
      }
      list.replaceChildren(...(slots.length ? rows : [el('p', { class: 'empty' }, [S.cal.bookEmpty])]),
        ...(slots.length > shown ? [el('button', { class: 'btn btn-ghost btn-sm', 'data-book-more': '', onclick: () => { shown += SHOWN; draw() } }, [S.cal.bookMore])] : []))
    }
    const send = (): void => {
      const slot = slots.find((x) => x.s === picked)
      const who = name.value.trim()
      if (!slot || !who) { h.toast(S.cal.bookedNeedName); return }
      const me = h.me()
      const reply: BookedPayload = { v: 1, id: p.id, slot, from: { name: who, ...(me.did ? { did: me.did } : {}) }, ...(note.value.trim() ? { note: note.value.trim() } : {}) }
      const link = encodeBookedLink(h.origin, reply)
      const owned = p.owner.did ? h.state().people.find((x) => x.peerId && (x.did === p.owner.did || x.peerId === p.owner.did)) : undefined
      out.replaceChildren(
        linkBox(link, 'data-booked-link-text', S.cal.bookedLinkCopied),
        ...(owned ? [el('button', { class: 'btn btn-ghost btn-sm', 'data-book-chat': '', onclick: () => { void h.sendInvite(owned.id, link).then((ok) => { if (ok) h.toast(S.cal.bookInChatDone) }) } }, [S.cal.bookInChat])] : []),
      )
    }
    const keep = (): void => { keepHeld(h.state(), owner, p.owner.did, Date.now()); h.save(); h.toast(S.cal.bookKept) }
    draw()
    h.sheet([el('div', { 'data-book-sheet': '' }, [
      el('h2', {}, [S.cal.bookTitle(p.owner.name)]), list, name, note,
      el('p', { class: 'meta' }, [S.cal.bookHint(p.owner.name)]),
      el('button', { class: 'btn btn-electric wide', 'data-book-send': '', onclick: send }, [S.cal.bookSend(p.owner.name)]), out,
      el('button', { class: 'btn btn-ghost wide', 'data-book-keep': '', onclick: keep }, [S.cal.bookKeep(owner.name)]),
    ])])
  }

  function bookedSheet(b: BookedPayload): void {
    if (!h.state().bookLinks?.some((l) => l.id === b.id)) { h.sheet([el('p', { 'data-booked-unknown': '' }, [S.cal.bookedUnknown])]); return }
    const accept = (): void => {
      const ev = acceptBooking(h.state(), b, h.newId(), Date.now())
      if (!ev) return
      h.state().events = [...(h.state().events ?? []), ev]
      h.save(); h.closeSheet(); h.redraw(); h.toast(S.cal.bookedAccepted)
    }
    h.sheet([el('div', { 'data-booked-sheet': '' }, [
      el('h2', {}, [S.cal.bookedWants(b.from.name, `${dayLabel(b.slot.s)} ${timeLabel(b.slot.s)}`)]),
      b.note ? el('p', {}, [b.note]) : null,
      el('button', { class: 'btn btn-electric wide', 'data-booked-accept': '', onclick: accept }, [S.cal.bookedAccept]),
      el('button', { class: 'btn btn-ghost wide', 'data-booked-decline': '', onclick: h.closeSheet }, [S.cal.bookedDecline]),
    ])])
  }

  return {
    button: () => el('button', { class: 'btn btn-ghost wide', 'data-cal-availability': '', onclick: availabilitySheet }, [S.cal.availability]),
    openLink: (hash) => {
      const book = decodeBookLink(hash)
      if (book) { bookingSheet(book); return true }
      const booked = decodeBookedLink(hash)
      if (booked) { bookedSheet(booked); return true }
      return false
    },
  }
}
