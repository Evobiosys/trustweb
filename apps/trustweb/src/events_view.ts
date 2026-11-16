/**
 * The Events screen (E1, wave 7): list, event page, add/edit form. Events and tags stay on this phone (events.ts).
 * Views are screens of their own (Screen.Events); the module keeps which one is showing.
 */
import { contextPress } from './context_press'
import { eventModeToggle } from './filter_bar_view'
import { el } from '../../demo/src/ui/dom'
import type { EventOffers } from './events'
import { DEFAULT_INVITE_POLICY, INVITE_POLICIES, NAME_REVEALS, applyEventSettings, attendees, coreLabel, deleteEvent, eventLabel, eventMatches, eventTagLabel, eventTagSlug, eventsSorted, inWeb, mayEdit, nameRevealOf, notifyOn, offersOf, restoreEvent, revealedBy, setEventTimes, sinceLabel, tagLabel, tagPerson, todayIso, untagPerson, untilLabel, whenLabel } from './events'
import { encodeEventLink, type EventBy } from './event_link'
import { eventForLink, isEventHost, mayApprove, relatedOthers } from './event_roles'
import { createEventEditor } from './event_editor_view'
import { draftsOf, rsvpTense } from './event_draft'
import type { EventDraft } from './event_draft'
import { eventPersonPicker } from './event_person_picker'
import { rolesSection } from './event_roles_view'
import { dragEvent, dragPerson } from './drag_payload'
import { PERSON_GREEN, loadColourTags } from './colour_tags'
import { listCommunities, parseCommunity } from './ext/community-mighty/community_data'
import { nicknamesOf, setNicknames } from './event_press'
import { ringColor } from './model'
import type { AppState, Invitation, Person, TwEvent } from './model'
import { invitationEventRows } from './invitations'
import { ICONS } from './icons'
import { S } from './strings'

export interface EventsViewHooks {
  state: () => AppState
  save: () => void
  header: (title: string, opts: { back?: () => void }) => HTMLElement
  /** Leave the Events screen (back to Web). */
  leave: () => void
  /** Redraw the screen after a change of view. */
  redraw: () => void
  /** The per-person Web Curator page (the default tap on an attendee). */
  curatorPerson: (personId: string) => void
  avatar: (name: string, id: string) => HTMLElement
  /** A card with an Undo button. */
  undoNotice: (title: string, onUndo: () => void) => void
  newId: () => string
  /** Copies a text and says so (the app's toast, or `done` as its words). */
  copyLink: (text: string, done?: string) => void
  /** Opens the join sheet for a pasted event link; false when the text holds none. */
  joinLink: (text: string) => boolean
  origin: string
  /** Who I am to a link's reader: my name and, when I have one, my relay identity. */
  by: () => EventBy | undefined
  /** Extension modules' sections on the event page (ext/registry.ts), drawn above Advanced. */
  extra?: (ev: TwEvent) => Node[]
  /** Wave 42 community-event: the sections of a community event (about, sign-up, roles, resources), drawn right under the date and place. */
  plan?: (ev: TwEvent) => Node[]
  /** Wave 43 event-feed: the Feed row of an event that offers a Feed, drawn under the date and place; null when it offers none. */
  feedRow?: (ev: TwEvent) => HTMLElement | null
  /** Wave 33: opens the edit sheet of an invitation shown among the events. */
  openInvitation?: (i: Invitation) => void
  /** Wave 27: the QR page of an event (qr_modes.ts): the event and my connect code in one code. */
  showQr?: (ev: TwEvent, host?: boolean) => void
  /** Wave 43: opens the ask-for-support sheet (an event that offers support shows its button). */
  askSupport?: () => void
  /** Wave 43 web-focus-filter: show the Web with only this event's people. */
  focusWeb?: (ev: TwEvent) => void
}

export interface EventsView {
  /** The screen's children, for render(). */
  body: () => Node[]
  /** Show this event's page, or the list without an id (the next body() draws it). */
  open: (eventId?: string, noBack?: boolean, edit?: boolean) => void
  /** Whether the plain list would draw now (the calendar stands in for it unless showList() was asked). */
  atList: () => boolean
  /** The add form, From preset to that day. */
  openForm: (fromIso?: string) => void
  /** The plain list (search, filter, paste a link) instead of the calendar. */
  showList: () => void
  /** Wave 28: the event whose page is open (the header's QR button then shows its code); undefined on the list, the calendar and the form. */
  current: () => TwEvent | undefined
}

type EventField = 'name' | 'where' | 'conditions' | 'themes' | 'organizer'
type View = { kind: 'list' } | { kind: 'page'; id: string; noBack?: boolean } | { kind: 'form'; id?: string; from?: string; focus?: EventField; draftId?: string }


export function createEventsView(h: EventsViewHooks): EventsView {
  let view: View = { kind: 'list' }
  /** The plain list was asked for from the calendar; any other change of view ends it. */
  let plain = false
  /** The share toggle "For the event host"; never saved, off whenever a page opens. */
  let hostLink = false
  /** Whether the Advanced disclosure stays open across redraws. */
  let advancedOpen = false
  /** The link copied last on this page, shown under the share button. */
  let lastLink = ''
  /** Wave 43: the since line shows its until / core days; its time editor is open; the notification sentence shows; the Nickname segment shows. All reset whenever a view opens. */
  let sinceOpen = false
  let timesOpen = false
  let notifyHint = false
  let revealOpen = false
  /** Wave 44: the open editor keeps what was typed across redraws; a change of view ends it. */
  let editor: { body: () => Node[] } | undefined
  const show = (v: View): void => { view = v; editor = undefined; plain = false; hostLink = false; advancedOpen = false; lastLink = ''; sinceOpen = false; timesOpen = false; notifyHint = false; revealOpen = false; h.redraw() }
  const find = (id: string): TwEvent | undefined => h.state().events?.find((e) => e.id === id)

  function row(ev: TwEvent): HTMLElement {
    const n = attendees(h.state(), ev.id).length
    return el('button', { class: 'prow', 'data-event': ev.id, onclick: () => show({ kind: 'page', id: ev.id }) }, [
      el('span', { class: 'who' }, [el('b', {}, [ev.name]), el('i', {}, [[whenLabel(ev), ev.where, S.eventsPeople(n)].filter(Boolean).join(' · ')])]),
    ])
  }

  /** Wave 33: an invitation among the events, tagged; a tap opens its edit sheet. */
  function invitationRow(r: { id: string; name: string; from: string; where: string }): HTMLElement {
    return el('button', { class: 'prow', 'data-event-invitation': r.id, onclick: () => { const i = h.state().invitations?.find((x) => x.id === r.id); if (i) h.openInvitation?.(i) } }, [
      el('span', { class: 'who' }, [el('b', {}, [r.name]), el('i', {}, [[r.from || S.invitedUndated, r.where].filter(Boolean).join(' · ')]), el('span', { class: 'tagpill', 'data-invitation-tag': '' }, [S.invitedTag])]),
    ])
  }

  /** Wave 44: an event not saved yet, with a Draft pill; a tap opens it in the editor. */
  function draftRow(d: EventDraft): HTMLElement {
    return el('button', { class: 'prow', 'data-event-draft': d.id, onclick: () => show({ kind: 'form', draftId: d.id }) }, [
      el('span', { class: 'who' }, [el('b', {}, [d.fields.name.trim() || S.ev44.draftUntitled]), el('i', {}, [[d.fields.from, d.fields.where].filter(Boolean).join(' · ')]), el('span', { class: 'tagpill', 'data-draft-pill': '' }, [S.ev44.draftPill])]),
    ])
  }

  /** A pasted link opens the same join sheet as the address bar does. */
  function pasteRow(): HTMLElement {
    const error = el('p', { class: 'warn', 'data-event-paste-error': '', hidden: true })
    const input = el('input', { class: 'field', placeholder: S.eventsPasteLink, 'aria-label': S.eventsPasteLink, 'data-event-paste': '' })
    const go = (): void => {
      const text = input.value.trim()
      if (!text) return
      error.hidden = h.joinLink(text)
      if (error.hidden) input.value = ''; else error.textContent = S.eventsPasteBad
    }
    input.addEventListener('paste', () => setTimeout(go))
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    return el('div', {}, [input, error])
  }

  function list(): Node[] {
    const { upcoming, past } = eventsSorted(h.state(), Date.now())
    const add = el('button', { class: 'btn btn-electric wide', 'data-event-add': '', onclick: () => show({ kind: 'form' }) }, [S.eventsAdd])
    const invited = (): HTMLElement[] => invitationEventRows(h.state(), '').map(invitationRow)
    const drafts = draftsOf(h.state()).map(draftRow)
    if (!upcoming.length && !past.length && !invited().length) return [h.header(S.eventsTitle, { back: h.leave }), el('div', { class: 'scroll' }, [...drafts, el('p', { class: 'empty' }, [S.eventsEmpty]), add, pasteRow()])]
    const rows = el('div', {}, [])
    const draw = (q: string): void => {
      const [up, pa] = [upcoming, past].map((l) => l.filter((e) => eventMatches(e, q)))
      rows.replaceChildren(...[
        up.length ? el('h3', {}, [S.eventsUpcoming]) : null, ...up.map(row),
        pa.length ? el('h3', {}, [S.eventsPast]) : null, ...pa.map(row),
        ...invitationEventRows(h.state(), q).map(invitationRow),
      ].filter((n): n is HTMLElement => n !== null))
    }
    draw('')
    const filter = upcoming.length + past.length + invited().length > 0
      ? el('input', { class: 'field', placeholder: S.eventsFilter, 'aria-label': S.eventsFilter, 'data-event-filter': '', oninput: (e: Event) => draw((e.target as HTMLInputElement).value) })
      : null
    return [h.header(S.eventsTitle, { back: h.leave }), el('div', { class: 'scroll' }, [...drafts, filter, rows, add, pasteRow()])]
  }

  function field(label: string, input: HTMLElement): Node[] {
    return [el('label', { class: 'meta' }, [label]), input]
  }

  /** Wave 43 answers (epsilon): "Part of a community" (a picker over the communities I have) or "Isolated event" (the default). The value is the community's colour tag id, empty = isolated. */
  function communityPick(current: string | undefined, onChange?: (id: string) => void): HTMLSelectElement {
    const st = h.state()
    const rows = listCommunities(parseCommunity(st.extData?.['community-mighty']), loadColourTags(), st.people)
    const known = current && !rows.some((r) => r.id === current) ? [{ id: current, name: current }] : []
    const pick = el('select', { class: 'field', 'aria-label': S.w43answers.community, 'data-event-community': '' }, [
      el('option', { value: '' }, [S.w43answers.communityNone]),
      ...[...rows, ...known].map((r) => el('option', { value: r.id, ...(r.id === current ? { selected: '' } : {}) }, [r.name])),
    ]) as HTMLSelectElement
    if (onChange) pick.addEventListener('change', () => onChange(pick.value))
    return pick
  }

  // Wave 44 event-editor: the add/edit form is event_editor_view.ts (old form archived: trustweb-ops DEVLOG/wave44/archive/event-editor).

  /** The avatar in its ring colour; without a ring: dashed, and a hint beside it. */
  function personBadge(p: Person): HTMLElement {
    const web = inWeb(p)
    return el('span', {
      class: 'pbadge', 'data-in-web': String(web),
      style: `border:1.5px ${web ? 'solid' : 'dashed'} ${web ? ringColor(p) : PERSON_GREEN}`,
    }, [h.avatar(p.name, p.id)])
  }

  const hint = (p: Person): HTMLElement | null => (inWeb(p) ? null : el('i', { class: 'not-in-web', 'data-not-in-web': p.id }, [S.eventsNotInWeb]))

  function attendeeRow(ev: TwEvent, p: Person): HTMLElement {
    const row = el('div', { class: 'prow', 'data-attendee': p.id }, [
      personBadge(p),
      el('button', { class: 'who', onclick: () => h.curatorPerson(p.id) }, [el('b', {}, [p.name]), hint(p)]),
      el('button', {
        class: 'btn btn-ghost btn-sm', 'aria-label': S.eventsUntag(p.name),
        onclick: () => { untagPerson(h.state(), p.id, ev.id); h.save(); h.redraw() },
      }, ['×']),
    ])
    contextPress(row, () => h.curatorPerson(p.id))
    return row
  }

  /** Wave 43: the Web glyph in the people header: the Web view with this event as its only filter. */
  function webFocusButton(ev: TwEvent): HTMLElement | null {
    if (!h.focusWeb) return null
    const b = el('button', { type: 'button', class: 'hdr-btn icon-only ev-web-focus', 'data-event-web-focus': '', 'aria-label': S.eventsWebFocus, title: S.eventsWebFocus, onclick: () => h.focusWeb?.(ev) })
    b.innerHTML = ICONS.web
    return b
  }

  /** "Identify a person": the shared picker (event_person_picker.ts); a pick tags the person with this event. */
  function picker(ev: TwEvent): HTMLElement {
    return el('div', {}, [el('h3', {}, [S.eventsIdentify]), eventPersonPicker(h, ev.id, {
      exclude: attendees(h.state(), ev.id).map((p) => p.id), tag: true, ariaLabel: S.eventsIdentify, inputAttr: 'data-event-tag-search', personAttr: 'data-tag-person',
      renderPerson: (p) => el('span', {}, [personBadge(p), el('span', { class: 'pwho' }, [p.name, hint(p)])]),
      decorate: (chip, p) => { contextPress(chip, () => h.curatorPerson(p.id)); dragPerson(chip, p) },
      onPick: (id) => { tagPerson(h.state(), id, ev.id); h.save(); h.redraw() },
      tags: loadColourTags, onPickMany: (ids) => { ids.forEach((id) => tagPerson(h.state(), id, ev.id)); h.save(); h.redraw() },   // wave 44 (item 11): # adds a whole group
    })])
  }

  function remove(ev: TwEvent): void {
    const gone = deleteEvent(h.state(), ev.id)
    if (!gone) return
    h.save()
    view = { kind: 'list' }
    h.redraw()
    h.undoNotice(S.eventsDeleted(ev.name), () => { restoreEvent(h.state(), gone); h.save(); h.redraw() })
  }

  /** Copies the link the toggle now shows (the host one says so in the toast) and redraws to preview it. E3: the peer link says of me only what the event's name reveal allows. */
  function copyShown(ev: TwEvent): void {
    lastLink = encodeEventLink(eventForLink(h.state(), ev), h.origin, hostLink ? 'host' : 'peer', hostLink ? undefined : revealedBy(h.by(), ev))
    h.copyLink(lastLink, hostLink ? S.eventHostLinkCopied : undefined)
    h.redraw()
  }

  /** The copied link, read-only on one line: shortened in the middle, whole (and selected) once tapped. */
  function linkPreview(): HTMLElement | null {
    if (!lastLink) return null
    const full = lastLink
    const short = full.length > 44 ? `${full.slice(0, 30)}…${full.slice(-12)}` : full
    const input = el('input', { class: 'field link-preview', readonly: '', value: short, 'aria-label': S.eventLinkPreview, 'data-event-link-preview': '' })
    input.addEventListener('focus', () => { input.value = full; input.select() })
    input.addEventListener('click', () => input.select())
    input.addEventListener('blur', () => { input.value = short })
    return input
  }

  /** Wave 43 (P2): ON = opens as event host; OFF = the same label struck through plus what it means. Switching copies the matching link at once. */
  function hostToggle(ev: TwEvent): HTMLElement {
    return el('div', {}, [
      el('button', {
        class: 'chip' + (hostLink ? ' on' : ' tw-off'), 'aria-pressed': String(hostLink), 'data-event-host-toggle': '',
        onclick: () => {
          hostLink = !hostLink
          copyShown(ev)
        },
      }, [S.w43press.hostOn]),
      hostLink ? null : el('small', { class: 'meta', 'data-event-host-off': '' }, [` ${S.w43press.hostOffNote}`]),
    ])
  }

  /** Wave 43: the share row, two icons side by side; the QR carries the link the toggle now shows. */
  function shareRow(ev: TwEvent): HTMLElement {
    const T = S.w43press
    const icon = (glyph: string, label: string, attr: string, onclick: () => void): HTMLElement =>
      el('button', { class: 'btn btn-ghost', type: 'button', 'aria-label': label, title: label, [attr]: '', onclick }, [el('span', { 'aria-hidden': 'true' }, [glyph]), ' ', el('u', {}, [label === S.eventLinkShare ? T.shareLink : T.shareQr])])
    return el('div', { class: 'chips event-share', 'data-event-share-row': '' }, [
      icon(T.iconLink, S.eventLinkShare, 'data-event-share', () => copyShown(ev)),
      h.showQr ? icon(T.iconQr, S.eventQrShare, 'data-event-qr', () => h.showQr?.(ev, hostLink)) : null,
    ])
  }

  /** E3: "Your name to other attendees": Full name | First name | Hidden. Wave 43: a long press on the segment reaches Nickname (the fourth, shown while open or chosen). A change saves (the default is not stored) and copies the shown link again. */
  function nameReveal(ev: TwEvent): HTMLElement {
    const cur = nameRevealOf(ev)
    const choose = (r: typeof cur): void => {
      if (r === cur) return
      applyEventSettings(ev, { nameReveal: r })
      h.save()
      if (lastLink) copyShown(ev); else h.redraw()
    }
    const group = el('div', { class: 'seg', role: 'group', 'aria-label': S.eventNameReveal, 'data-event-reveal-seg': '' }, NAME_REVEALS.filter((r) => r !== 'nick' || revealOpen || cur === 'nick').map((r) => el('button', {
      type: 'button', class: r === cur ? 'on' : '', 'aria-pressed': String(r === cur), 'data-event-name-reveal': r,
      onclick: () => choose(r),
    }, [S.eventNameRevealOpt[r]])))
    contextPress(group, () => { revealOpen = true; if (cur === 'nick') h.redraw(); else choose('nick') })
    const nick = el('input', { class: 'field', value: nicknamesOf(h.state().me).join(', '), placeholder: S.w43press.nickLabel, 'aria-label': S.w43press.nickLabel, 'data-event-nickname': '' })
    nick.addEventListener('change', () => {
      setNicknames(h.state().me, nick.value.split(','))
      h.save()
      if (lastLink) copyShown(ev)
    })
    return el('div', { class: 'event-reveal', 'data-event-reveal': cur }, [
      el('label', { class: 'meta' }, [S.eventNameReveal]),
      group,
      cur === 'nick' ? el('div', {}, [nick, el('p', { class: 'meta' }, [S.w43press.nickHint + ' ' + S.w43answers.nicknamesHint])]) : null,
      el('p', { class: 'meta' }, [S.eventNameRevealHint]),
    ])
  }

  /** Wave 43: people tied to the event only through roles or invitations; read-only chips, a press opens the person page. */
  function others(ev: TwEvent): Node[] {
    const list = relatedOthers(h.state(), ev)
    if (!list.length) return []
    return [el('h3', {}, [S.eventsOthersRelated]), el('div', { class: 'chips', 'data-event-others': '' }, list.map((p) => el('button', { class: 'chip', type: 'button', 'data-other-person': p.id, onclick: () => h.curatorPerson(p.id) }, [p.name])))]
  }

  /** An on/off control for a greyscale screen (P2): off = struck through, never colour alone. */
  function toggle(on: boolean, label: string, attr: string, onclick: () => void): HTMLElement {
    return el('button', { class: 'chip' + (on ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(on), [attr]: '', onclick }, [label])
  }

  /** Wave 43 answers (zeta): the host names a Mastodon instance; the event Feed merges its public posts under the event tag. A change saves when the field loses focus; a bad host shows a line and keeps the old one. */
  function mastodonInput(ev: TwEvent): HTMLElement {
    const input = el('input', { class: 'field', value: ev.mastodonInstance ?? '', placeholder: S.w43answers.mastodonPh, 'aria-label': S.w43answers.mastodon, 'data-event-mastodon': '' }) as HTMLInputElement
    const bad = el('p', { class: 'warn', 'data-event-mastodon-bad': '', hidden: true }, [S.w43answers.mastodonBad])
    input.addEventListener('change', () => {
      try { applyEventSettings(ev, { mastodonInstance: input.value }); bad.hidden = true; h.save(); input.value = ev.mastodonInstance ?? '' } catch { bad.hidden = false }
    })
    return el('div', {}, [input, bad])
  }

  /** Wave 43 answers (iota): my nickname at this event; the Nickname reveal of this event uses it, else my first nickname. */
  function myNicknameInput(ev: TwEvent): HTMLInputElement {
    const input = el('input', { class: 'field', value: ev.myNickname ?? '', placeholder: nicknamesOf(h.state().me)[0] ?? '', 'aria-label': S.w43answers.myNickname, 'data-event-my-nickname': '' }) as HTMLInputElement
    input.addEventListener('change', () => { applyEventSettings(ev, { myNickname: input.value }); h.save(); if (lastLink) copyShown(ev) })
    return input
  }

  /** Renaming the tag locks it against the host and copies the link now showing (host or peer) again at once with the new name. */
  function advanced(ev: TwEvent): HTMLElement {
    const name = el('input', { class: 'field', value: tagLabel(ev), 'aria-label': S.eventTagName, 'data-event-tag-name': '' })
    name.addEventListener('change', () => {
      const v = name.value.trim()
      if (!v || v === tagLabel(ev)) { name.value = tagLabel(ev); return }
      ev.tagName = v
      ev.tagLocked = true
      h.save()
      copyShown(ev)
    })
    const hostNames = el('input', { type: 'checkbox', 'data-event-host-names': '' })
    hostNames.checked = ev.hostNamesTags !== false
    hostNames.addEventListener('change', () => { ev.hostNamesTags = hostNames.checked; h.save() })
    const T = S.w43press
    const policy = ev.invitePolicy ?? DEFAULT_INVITE_POLICY
    const offers = offersOf(ev)
    const offerRows: [keyof EventOffers, string][] = [['support', T.offerSupport], ['resources', T.offerResources], ['feed', T.offerFeed]]
    const box = el('details', { 'data-event-advanced': '' }, [
      el('summary', {}, [S.eventAdvanced]),
      ...field(S.eventTagName, name),
      el('label', { class: 'meta' }, [hostNames, ' ', S.eventHostNamesTags]),
      ...others(ev),
      mayApprove(ev, h.state().me.displayName, h.state().people) ? el('div', { 'data-event-invite-policy': policy }, [
        el('label', { class: 'meta' }, [T.invitePolicy]),
        el('div', { class: 'seg', role: 'group', 'aria-label': T.invitePolicy }, INVITE_POLICIES.map((p) => el('button', {
          type: 'button', class: p === policy ? 'on' : '', 'aria-pressed': String(p === policy), 'data-event-invite-policy-opt': p,
          onclick: () => { applyEventSettings(ev, { invitePolicy: p }); h.save(); h.redraw() },
        }, [T.invitePolicyOpt[p]]))),
        el('p', { class: 'meta' }, [T.invitePolicyHint]),
        el('p', { class: 'meta', 'data-event-host-only-hint': '' }, [S.shellFix2.hostOnlyHint]),
      ]) : null,
      ...(mayEdit(ev, h.state().me.displayName, h.state().people) ? [
        ...field(S.w43answers.community, communityPick(ev.communityId, (id) => { applyEventSettings(ev, { communityId: id }); h.save() })), el('p', { class: 'meta' }, [S.w43answers.communityHint]),
        ...field(S.w43answers.mastodon, mastodonInput(ev)), el('p', { class: 'meta' }, [S.w43answers.mastodonHint]),
      ] : []),
      // Wave 43b (B5): the host chooses what people see when they open this event's link.
      ...(mayEdit(ev, h.state().me.displayName, h.state().people) ? [el('div', { 'data-event-link-mode': ev.linkMode ?? 'full' }, [
        el('label', { class: 'meta' }, [S.w43shell.linkMode]),
        el('div', { class: 'seg', role: 'group', 'aria-label': S.w43shell.linkMode }, (['full', 'event'] as const).map((m) => el('button', {
          type: 'button', class: m === (ev.linkMode ?? 'full') ? 'on' : '', 'aria-pressed': String(m === (ev.linkMode ?? 'full')), 'data-event-link-mode-opt': m,
          onclick: () => { if (m === 'event') ev.linkMode = 'event'; else delete ev.linkMode; h.save(); h.redraw() },
        }, [m === 'full' ? S.w43shell.linkModeFull : S.w43shell.linkModeEvent]))),
      ])] : []),
      ...field(S.w43answers.myNickname, myNicknameInput(ev)), el('p', { class: 'meta' }, [S.w43answers.myNicknameHint]),
      el('label', { class: 'meta' }, [T.offers]),
      el('div', { class: 'chips', 'data-event-offers': '' }, offerRows.map(([k, label]) => toggle(offers[k], label, `data-event-offer-${k}`, () => { applyEventSettings(ev, { offers: { [k]: !offers[k] } }); h.save(); h.redraw() }))),
      el('p', { class: 'meta', 'data-event-feed-hint': '' }, [S.ev44.feedHint]),
    ])
    box.open = advancedOpen
    box.addEventListener('toggle', () => { advancedOpen = box.open })
    return box
  }

  /** Wave 43 (P1): single press = more, or the edit sheet when there is nothing more; long press or right click = the edit sheet on that field. */
  function editable<T extends HTMLElement>(node: T, ev: TwEvent, focus: EventField, more?: () => void): T {
    const edit = (): void => show({ kind: 'form', id: ev.id, focus })
    node.classList.add('press')
    node.addEventListener('click', () => (more ?? edit)())
    contextPress(node, edit)
    return node
  }

  /** Wave 43: "since 09:30 today"; a press shows until and the core days; a long press edits when I am there (inline, saved when a field loses focus). */
  function sinceLine(ev: TwEvent): HTMLElement {
    const today = todayIso(new Date())
    const label = sinceLabel(ev, today)
    const until = label.startsWith('since') ? untilLabel(ev) : ''
    const more = !!(until || ev.core)
    const head = el('button', { class: 'press event-since', type: 'button', 'aria-expanded': String(sinceOpen), 'data-event-since': '' }, [el('b', {}, [label])])
    // Wave 44 (item 10): the V toggle at the right shows until and the core time; open it turns into the roof (the contact editor's expander).
    const vee = more ? el('button', { class: 'tw-expander', type: 'button', 'aria-expanded': String(sinceOpen), 'aria-label': sinceOpen ? S.w43press.collapse : S.w43press.expand, 'data-event-since-toggle': '', onclick: () => { sinceOpen = !sinceOpen; h.redraw() } }, [sinceOpen ? '▴' : '▾']) : null
    head.title = sinceOpen ? S.w43press.collapse : S.w43press.expand
    head.addEventListener('click', () => { if (more) sinceOpen = !sinceOpen; else timesOpen = true; h.redraw() })
    contextPress(head, () => { timesOpen = true; h.redraw() })
    return el('div', { 'data-event-when': '' }, [
      el('div', { class: 'roles-line' }, [head, vee]),
      sinceOpen && until ? el('p', { class: 'meta', 'data-event-until': '' }, [until]) : null,
      sinceOpen && ev.core ? el('p', { class: 'meta', 'data-event-core': '' }, [coreLabel(ev)]) : null,
      timesOpen ? timesEditor(ev) : null,
    ])
  }

  function timesEditor(ev: TwEvent): HTMLElement {
    const T = S.w43press
    const input = (v: string): HTMLInputElement => el('input', { class: 'field', type: 'datetime-local', value: v.length === 10 ? `${v}T00:00` : v })
    const from = input(ev.from)
    const to = input(ev.to ?? '')
    const error = el('p', { class: 'warn', 'data-event-times-error': '', hidden: true }, [T.timesBad])
    // A date the person never gave a time stays a plain date.
    const value = (i: HTMLInputElement, was: string): string => (i.value.endsWith('T00:00') && was.length <= 10 ? i.value.slice(0, 10) : i.value)
    const box = el('div', { class: 'event-times', 'data-event-times': '' }, [
      el('label', { class: 'meta' }, [T.timesFrom]), from, el('label', { class: 'meta' }, [T.timesTo]), to, error,
    ])
    const save = (): void => {
      const bad = setEventTimes(ev, value(from, ev.from) || ev.from, value(to, ev.to ?? ''))
      error.hidden = !bad
      if (!bad) h.save()
    }
    from.addEventListener('change', save)
    to.addEventListener('change', save)
    box.addEventListener('focusout', (e) => { if (!box.contains((e as FocusEvent).relatedTarget as Node | null) && error.hidden) { timesOpen = false; h.redraw() } })
    setTimeout(() => to.focus())
    return box
  }

  /** Wave 44 (43-D7): technical support sees the event; it approves only once a host lets it take over. */
  function techLine(ev: TwEvent): HTMLElement | null {
    const st = h.state()
    if (!isEventHost(ev, st.me.displayName, st.people) || mayApprove({ ...ev, techTakeover: undefined }, st.me.displayName, st.people)) return null
    return el('p', { class: 'meta', 'data-event-tech-line': ev.techTakeover ? 'takeover' : 'sees' }, [ev.techTakeover ? S.ev44.techCan : S.ev44.techSees])
  }

  function page(ev: TwEvent): Node[] {
    const people = attendees(h.state(), ev.id)
    const attended = el('button', {
      class: 'chip' + (ev.attended ? ' on' : ' tw-off'), role: 'switch', 'aria-checked': String(ev.attended), 'aria-pressed': String(ev.attended), 'data-event-attended': '',
      onclick: () => { ev.attended = !ev.attended; h.save(); h.redraw() },
    }, [rsvpTense(ev, Date.now()) === 'future' ? S.ev44.willAttend : S.eventsAttended])   // wave 44 (item 13)
    // review-fixes-43: one switch for this event's notifications; it also covers the "I'm here now" bell (a muted bell of older records shows as off, switching on clears it).
    const st = h.state()
    const notifyNow = notifyOn(ev) && !(st.atEvent?.eventId === ev.id && st.atEvent.bell === false)
    const notify = toggle(notifyNow, S.w43press.notify, 'data-event-notify', () => {
      applyEventSettings(ev, { notify: !notifyNow })
      if (!notifyNow && st.atEvent?.eventId === ev.id) delete st.atEvent.bell
      h.save(); h.redraw()
    })
    contextPress(notify, () => { notifyHint = !notifyHint; h.redraw() })
    const title = h.header(ev.name, view.kind === 'page' && view.noBack ? {} : { back: () => show({ kind: 'list' }) })   // wave 40: from the calendar it is a regular event card, no Back button
    dragEvent(title, { id: ev.id, name: ev.name }, eventLabel(ev))
    // review-fixes-43: the event name in the header is a line of the page too (P1): nothing to expand, so a press edits; a long press / right click edits with the name focused.
    const nameLine = title.querySelector('h2')
    if (nameLine) { nameLine.setAttribute('data-event-name-line', ''); nameLine.setAttribute('role', 'button'); nameLine.tabIndex = 0; editable(nameLine, ev, 'name') }
    // P4: the tag as this device calls it (tagLabel: the tag name, else the event name), the same text the Web filter and the Feed show.
    const tag = tagLabel(ev)
    const tagChip = el('button', { class: 'chip event-tag-chip', type: 'button', 'data-event-tag-chip': tag, 'aria-label': S.eventsTagChipAria(eventTagLabel(tag)), onclick: () => h.copyLink(eventTagSlug(tag), S.eventsTagCopied) }, [eventTagLabel(tag)])
    contextPress(tagChip, () => show({ kind: 'form', id: ev.id }))
    return [title, el('div', { class: 'scroll events-page' }, [
      tagChip,
      sinceLine(ev),
      ev.where ? editable(el('p', { 'data-event-where': '' }, [ev.where]), ev, 'where') : null,
      rolesSection(h, ev),
      techLine(ev),
      ev.themes ? editable(el('div', { class: 'chips', 'data-event-themes': '' }, ev.themes.map((t) => el('span', { class: 'chip' }, [t]))), ev, 'themes') : null,
      ev.conditions ? editable(el('p', { 'data-event-conditions': '' }, [ev.conditions]), ev, 'conditions') : null,
      ...(h.plan?.(ev) ?? []),
      h.feedRow?.(ev) ?? null,
      offersOf(ev).support && h.askSupport ? el('button', { class: 'btn btn-ghost wide', 'data-event-ask-support': '', onclick: () => h.askSupport?.() }, [S.w43press.askSupport]) : null,
      el('div', { class: 'chips' }, [attended, notify, eventModeToggle({ state: h.state, save: h.save, redraw: h.redraw }, ev.id)]),
      notifyHint ? el('p', { class: 'meta', 'data-event-notify-hint': '' }, [S.w43press.notifyHint]) : null,
      shareRow(ev),
      hostToggle(ev),
      linkPreview(),
      el('p', { class: 'meta' }, [S.eventLinkHint]),
      nameReveal(ev),
      el('div', { class: 'ev-people-head' }, [el('h3', {}, [S.eventsAssociated(tagLabel(ev))]), webFocusButton(ev)]),
      people.length ? el('div', {}, people.map((p) => attendeeRow(ev, p))) : el('p', { class: 'empty meta' }, [S.eventsNoAttendees]),
      ev.fromLink ? el('p', { class: 'meta', 'data-event-nudge': '' }, [S.eventLinkNudge]) : null,
      picker(ev),
      ...(h.extra?.(ev) ?? []),
      advanced(ev),
      el('button', { class: 'btn btn-ghost wide', 'data-event-edit': '', onclick: () => show({ kind: 'form', id: ev.id }) }, [S.eventsEdit]),
      el('button', { class: 'btn btn-ghost wide', 'data-event-delete': '', onclick: () => remove(ev) }, [S.eventsDelete]),
    ])]
  }

  return {
    atList: () => view.kind === 'list' && !plain,
    openForm: (from) => show({ kind: 'form', ...(from ? { from } : {}) }),
    showList: () => { view = { kind: 'list' }; plain = true; h.redraw() },
    current: () => (view.kind === 'page' ? find(view.id) : undefined),
    open: (id, noBack, edit) => { view = id ? (edit ? { kind: 'form', id } : { kind: 'page', id, ...(noBack ? { noBack } : {}) }) : { kind: 'list' } },
    body: () => {
      const ev = view.kind === 'list' ? undefined : find(view.id ?? '')
      if (view.kind === 'form') {
        const v = view
        const draft = v.draftId ? draftsOf(h.state()).find((d) => d.id === v.draftId) : undefined
        editor ??= createEventEditor(h, {
          ...(ev ? { existing: ev } : draft?.eventId ? { existing: find(draft.eventId) } : {}), ...(draft ? { draft } : {}), ...(v.from ? { presetFrom: v.from } : {}), ...(v.focus ? { focus: v.focus } : {}),
          done: (id) => show({ kind: 'page', id }),
          // Left without saving: back to the event, else to the plain list, where a saved draft now waits (the calendar would hide it).
          leave: () => { if (ev) show({ kind: 'page', id: ev.id }); else { show({ kind: 'list' }); plain = true; h.redraw() } },
        })
        return editor.body()
      }
      if (view.kind === 'page' && ev) return page(ev)
      view = { kind: 'list' }
      return list()
    },
  }
}
