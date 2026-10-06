/**
 * The transcript player of a past meeting (wave 1733, item 4b, LINE level per
 * amendment A7 / Tana pjrBbzZkTRI2): tap a transcript line to play the
 * recording from that line's moment; while it plays, the line being spoken is
 * highlighted and followed, but only while the reader is at the playing
 * position (scrolling away to reread is never yanked back, the same rule as
 * the live transcript). An item's "play from this moment" lands here too.
 *
 * Seeking happens on the stored take through an <audio> element, never by
 * decoding a take into memory (1 h of PCM is about 700 MB). Chromium's WebM
 * takes carry a Duration (webm_duration.ts), so the element knows the length
 * and can seek. A recording of several takes plays them one after another on
 * one timeline (audio_store.ts locate).
 */
import { el } from '../../demo/src/ui/dom'
import { locate } from './audio_store'
import type { StoredAudio } from './audio_store'
import type { TranscriptLine } from './model'
import { transcriptIndexAt } from './provenance'
import { S } from './strings'

export interface PlayerHandle {
  /** The bar to put above the transcript. */
  bar: HTMLElement
  playFrom(atMs: number): Promise<void>
  stop(): void
}

export interface PlayerOptions {
  transcript: readonly TranscriptLine[]
  /** The rendered row of transcript line i. */
  row: (i: number) => HTMLElement | null
  /** "1:05", for the time readout. */
  clock: (ms: number) => string
  /** The app's own play and pause icons (SVG markup). */
  icons: { play: string; pause: string }
}

/** How long to wait for a seek before playing anyway. */
const SEEK_TIMEOUT_MS = 4_000

function once(target: EventTarget, type: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs)
    target.addEventListener(type, () => { clearTimeout(t); resolve() }, { once: true })
  })
}

/** Is `row` inside the visible part of its scrolling list? */
function inView(row: HTMLElement): boolean {
  const list = row.closest<HTMLElement>('.tr-static')
  if (!list) return true
  const r = row.getBoundingClientRect()
  const box = list.getBoundingClientRect()
  return r.bottom > box.top && r.top < box.bottom
}

export function mountPlayer(audio: StoredAudio, o: PlayerOptions): PlayerHandle {
  const takes = audio.takes
  const total = takes.reduce((n, t) => Math.max(n, t.offsetMs + t.durationMs), 0)
  const urls = takes.map((t) => URL.createObjectURL(t.blob))
  const a = el('audio', { preload: 'metadata', class: 'pm-audio' }) as HTMLAudioElement
  let current = -1
  let lit = -1
  let stopped = false
  const time = el('span', { class: 'pm-time' }, [`0:00 / ${o.clock(total)}`])
  const toggle = el('button', { class: 'pm-play', 'aria-label': S.playerPlay, onclick: () => { if (a.paused) void (current < 0 ? playFrom(0) : a.play()); else a.pause() } })
  toggle.innerHTML = o.icons.play
  const bar = el('div', { class: 'pm-player', role: 'group', 'aria-label': S.playerLabel }, [
    toggle, time, el('small', { class: 'pm-player-hint' }, [S.playerHint]), a,
  ])

  const at = (): number => (current < 0 ? 0 : takes[current].offsetMs + a.currentTime * 1000)

  const light = (): void => {
    const ms = at()
    bar.dataset.at = String(Math.round(ms))
    time.textContent = `${o.clock(ms)} / ${o.clock(total)}`
    const i = transcriptIndexAt(o.transcript, ms)
    if (i === lit) return
    const prev = lit >= 0 ? o.row(lit) : null
    const follow = !prev || inView(prev)
    prev?.classList.remove('tr-now')
    lit = i
    const row = i >= 0 ? o.row(i) : null
    row?.classList.add('tr-now')
    if (row && follow) row.scrollIntoView({ block: 'nearest' })
  }

  const showState = (): void => {
    const playing = !a.paused
    toggle.classList.toggle('on', playing)
    toggle.setAttribute('aria-label', playing ? S.playerPause : S.playerPlay)
    toggle.innerHTML = playing ? o.icons.pause : o.icons.play
    bar.dataset.playing = playing ? '1' : '0'
  }

  async function load(take: number): Promise<void> {
    if (take === current) return
    current = take
    a.src = urls[take]
    await once(a, 'loadedmetadata', SEEK_TIMEOUT_MS)
  }

  async function playFrom(ms: number): Promise<void> {
    const where = locate(takes, ms)
    if (!where || stopped) return
    await load(where.take)
    const target = where.withinMs / 1000
    if (Math.abs(a.currentTime - target) > 0.01) {
      const seeked = once(a, 'seeked', SEEK_TIMEOUT_MS)
      a.currentTime = target
      await seeked
    }
    if (lit >= 0) o.row(lit)?.classList.remove('tr-now')
    lit = -1
    light()
    await a.play().catch(() => undefined)
  }

  a.addEventListener('timeupdate', light)
  a.addEventListener('play', showState)
  a.addEventListener('pause', showState)
  a.addEventListener('ended', () => {
    if (current + 1 < takes.length) void playFrom(takes[current + 1].offsetMs)
    else showState()
  })

  return {
    bar,
    playFrom,
    stop: (): void => {
      stopped = true
      a.pause()
      a.removeAttribute('src')
      a.load()
      urls.forEach((u) => URL.revokeObjectURL(u))
      if (lit >= 0) o.row(lit)?.classList.remove('tr-now')
    },
  }
}
