/**
 * The "Advanced" disclosure on a person's card (wave 6e): the General note, plain text, saved as it is typed. DOM and words only: the
 * rules of the note are general_notes.ts, the two-minute memory of "was open" is notes_advanced_memory.ts.
 *
 * Collapsed on every new card, unless it was open within the last two minutes (one stamp for the whole phone). A typed note shows at once;
 * a voice note of this person that is still being transcribed is named next to it, so the person is not left looking at an empty card.
 */
import { el } from '../../demo/src/ui/dom'
import { GENERAL_NOTE_MAX, createAutosaver } from './general_notes'
import type { AutosaveDeps } from './general_notes'
import type { AdvancedMemory } from './notes_advanced_memory'
import { S } from './strings'

export interface GeneralSectionOptions {
  /** The person's name, for the placeholder. */
  name: string
  /** The stored note now. */
  note: () => string
  /** Writes the note into the record and saves (setGeneralNote + save). */
  commit: (text: string) => void
  memory: AdvancedMemory
  /** How many voice notes of this person are still being transcribed. */
  pendingVoice: () => number
  /** Autosave timing, for tests. */
  autosave?: Pick<AutosaveDeps, 'delayMs' | 'setTimer' | 'clearTimer'>
}

export interface GeneralSection {
  el: HTMLElement
  /** Saves what is waiting (the card is closing, the page is hidden). */
  flush(): void
}

/** Re-stamping "was open" while typing at most this often (one localStorage write per keystroke is not needed for a two-minute memory). */
const MARK_EVERY_MS = 10_000

interface LiveSection { root: HTMLElement; flush: () => void }
/** The sections built on this page; ONE pair of page listeners serves them all (no listener per card that lives on after the card). */
const live = new Set<LiveSection>()
let pageHooked = false

/** Saves what every section is waiting with, and forgets the sections that left the page. */
function flushLive(): void {
  for (const s of [...live]) {
    s.flush()
    if (!s.root.isConnected) live.delete(s)
  }
}

/** Adds a section; a section that already left the page is saved one last time and forgotten. */
function track(section: LiveSection): void {
  for (const s of [...live]) if (!s.root.isConnected) { s.flush(); live.delete(s) }
  live.add(section)
  if (pageHooked) return
  pageHooked = true
  // A card closed or a page hidden while a pause is running must not lose the last words.
  document.addEventListener('visibilitychange', flushLive)
  window.addEventListener('pagehide', flushLive)
}

export function createGeneralSection(o: GeneralSectionOptions): GeneralSection {
  const startsOpen = o.memory.wasOpen()
  const toggle = el('button', {
    class: 'btn btn-ghost btn-sm person-advanced-toggle', type: 'button', 'data-act': 'person-advanced', 'aria-expanded': String(startsOpen),
  }, [S.personAdvanced + (startsOpen ? ' ▴' : ' ▾')])
  const area = el('textarea', {
    class: 'field general-note', rows: '5', maxlength: String(GENERAL_NOTE_MAX), placeholder: S.generalNotePh(o.name), 'aria-label': S.generalNoteTitle,
    'data-general-note': '', spellcheck: 'true',
  })
  area.value = o.note()
  const status = el('p', { class: 'meta', role: 'status', 'data-general-status': '' })
  const voice = el('p', { class: 'meta', 'data-general-transcribing': '', hidden: true })
  const panel = el('div', { class: 'person-advanced-panel', hidden: !startsOpen, 'data-person-advanced-panel': '' }, [
    el('h4', { class: 'eyebrow' }, [S.generalNoteTitle]), voice, area, status, el('p', { class: 'meta' }, [S.generalNoteHint]),
  ])
  const root = el('div', { class: 'person-advanced', 'data-person-advanced': '' }, [toggle, panel])

  const drawVoice = (): void => {
    const n = o.pendingVoice()
    voice.hidden = n === 0
    voice.textContent = n === 0 ? '' : S.generalNoteTranscribing(n)
  }
  drawVoice()

  const saver = createAutosaver({
    ...o.autosave,
    commit: (text) => {
      o.commit(text)
      status.textContent = S.generalNoteSaved
    },
  })
  let markedAt = Number.NEGATIVE_INFINITY
  area.addEventListener('input', () => {
    const t = Date.now()
    if (t - markedAt >= MARK_EVERY_MS) { markedAt = t; o.memory.markOpen() }
    status.textContent = S.generalNoteSaving
    saver.input(area.value)
  })
  area.addEventListener('blur', () => saver.flush())
  toggle.addEventListener('click', () => {
    const open = panel.hidden
    panel.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    toggle.textContent = S.personAdvanced + (open ? ' ▴' : ' ▾')
    if (open) { o.memory.markOpen(); drawVoice(); area.focus() } else { saver.flush(); o.memory.markClosed() }
  })
  track({ root, flush: () => saver.flush() })
  return {
    el: root,
    flush: () => saver.flush(),
  }
}
