/**
 * Settings > "Hosted on the Swiss server" and its sheet (wave 1733 round B,
 * item 4): off by default; on, every recording kept on this phone is sealed
 * here and stored under the person's hosted account, within the free 10 hours
 * (the bar shows hours used of 10, from the server's own numbers). Per
 * recording: hosted / on this phone only, host it, remove it from the server,
 * fetch it back. At the allowance: the plain message and "Tell us what would
 * be fair", never a dead end, nothing lost on the phone. The wording follows
 * what GET /hosted/status says is switched on. Logic in hosting.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { aboutUrl, AboutPage } from './about'
import type { AudioStore } from './audio_store'
import { fetchBack, hostAll, hostingRows, HostOutcome, hostOne, hoursOf, reconcile, toHost, unhost } from './hosting'
import type { HostingDeps } from './hosting'
import type { AppState, PastMeeting } from './model'
import { clock } from './recorder'
import { askPersist } from './storage_persist'
import { S } from './strings'
import type { SwissContext } from './swiss_context'
import { readHosting } from './swiss_context'
import { deleteRecording, fetchUsage, getRecording, listRecordings, putRecording } from './swiss_server'
import type { Usage } from './swiss_server'

export interface HostingViewHooks {
  ctx: SwissContext
  state: () => AppState
  save: () => void
  audio: AudioStore
  sheet: HTMLElement
  openSheet: (children: (Node | null)[]) => void
  toast: (msg: string) => void
  when: (at: number) => string
  /** Settings redraws (the toggle and the usage line live there). */
  redrawSettings: () => void
}

export interface HostingView {
  /** The Settings group (empty where the server is not asked, or on a demo phone). */
  settingsGroup(): (HTMLElement | null)[]
  open(): void
  /** A recording was just kept on this phone: hosted at once while hosting is on. */
  afterKeep(meetingId: string): void
  /** A meeting was deleted on this phone: its hosted copy goes too. */
  removed(meetingId: string): void
  /** At app open: what waits to be hosted goes up (hosting on only). */
  boot(): void
}

const SHEET_KIND = 'hosting'

export function createHostingView(h: HostingViewHooks): HostingView {
  let usage: Usage | null = null
  /** The server answered 402 this visit: the next recording did not fit (cleared when something is removed). */
  let refused = false
  let busy = false
  const reachedNow = (): boolean => refused || Boolean(usage && usage.secondsUsed >= usage.secondsLimit)

  const deps: HostingDeps = {
    account: h.ctx.account,
    hosting: h.ctx.hosting,
    loadAudio: (id) => h.audio.load(id),
    saveAudio: async (id, takes) => { await h.audio.save(id, takes) },
    put: (a, rid, seconds, sealed) => putRecording(a, rid, seconds, sealed),
    get: (a, rid) => getRecording(a, rid),
    remove: (a, rid) => deleteRecording(a, rid),
    save: h.save,
    now: Date.now,
  }

  const hosted = (): boolean => h.ctx.status()?.hosted === true
  const isOn = (): boolean => readHosting(h.state())?.on === true
  const showing = (): boolean => h.sheet.dataset.kind === SHEET_KIND && h.sheet.classList.contains('on')
  const redraw = (): void => { if (showing()) open(); else h.redrawSettings() }
  const meetings = (): PastMeeting[] => h.state().meetings ?? []

  async function refreshUsage(): Promise<void> {
    try {
      const a = await h.ctx.account()
      usage = await fetchUsage(a)
      const server = await listRecordings(a)
      const hs = readHosting(h.state())
      if (hs && reconcile(hs, server)) h.save()
    } catch { /* the sheet keeps what it knew */ }
  }

  function note(outcome: HostOutcome): void {
    if (outcome === HostOutcome.Allowance) { refused = true; h.toast(S.hostAllowanceToast) }
    else if (outcome === HostOutcome.TooLong) h.toast(S.hostTooLong)
    else if (outcome === HostOutcome.Failed) h.toast(S.hostFailed)
  }

  async function hostWaiting(): Promise<void> {
    const hs = readHosting(h.state())
    if (busy || !hs?.on || !hosted()) return
    busy = true
    try {
      const ids = toHost(hs, await h.audio.entries(), meetings())
      if (!ids.length) return
      const r = await hostAll(ids, deps, () => { if (showing()) open() })
      if (r.stoppedBy) note(r.stoppedBy)
      else if (r.hosted) h.toast(S.hostDone(r.hosted))
      await refreshUsage()
    } finally {
      busy = false
      redraw()
    }
  }

  function setOn(on: boolean): void {
    try {
      h.ctx.hosting().on = on
    } catch {
      // A hosting state this build cannot read is left exactly as it is (it may hold the only key to stored recordings).
      h.toast(S.hostFailed)
      return
    }
    h.save()
    if (on) void askPersist()
    redraw()
    if (on) void hostWaiting()
  }

  function usageView(): HTMLElement | null {
    if (!usage) return null
    const { used, limit } = hoursOf(usage)
    const pct = Math.min(100, limit ? (used / limit) * 100 : 0)
    const bar = el('div', { class: 'usage-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(limit), 'aria-valuenow': String(used), 'aria-label': S.hostUsage(used.toFixed(2), String(limit)) }, [
      el('span', {}),
    ])
    ;(bar.firstChild as HTMLElement).style.width = pct + '%'
    return el('div', { class: 'usage', 'data-hosting-usage': used.toFixed(2) }, [bar, el('p', { class: 'meta' }, [S.hostUsage(used.toFixed(2), String(limit))])])
  }

  function allowanceView(): HTMLElement | null {
    if (!reachedNow()) return null
    return el('div', { class: 'warn', 'data-hosting-allowance': '1' }, [
      el('p', {}, [S.hostAllowance]),
      el('a', { class: 'btn btn-ghost btn-sm', href: aboutUrl(AboutPage.Feedback), target: '_blank', rel: 'noopener noreferrer' }, [S.fairPrice]),
    ])
  }

  function rowView(r: ReturnType<typeof hostingRows>[number]): HTMLElement {
    const m = meetings().find((x) => x.id === r.meetingId)
    const label = m ? `${m.about} · ${h.when(m.startedAt)}${m.durationMs ? ' · ' + clock(m.durationMs) : ''}` : S.hostMeetingGone
    const stateText = r.rec ? (r.onPhone ? S.hostStateBoth : S.hostStateServerOnly) : S.hostStatePhoneOnly
    const act = (label2: string, attr: string, run: () => Promise<unknown>): HTMLElement => el('button', {
      class: 'btn btn-ghost btn-sm', [attr]: r.meetingId,
      onclick: () => { if (busy) return; busy = true; void run().finally(() => { busy = false; void refreshUsage().then(redraw) }) },
    }, [label2])
    return el('div', { class: 'conn-row host-row', 'data-host-row': r.meetingId, 'data-host-state': r.rec ? (r.onPhone ? 'both' : 'server') : 'phone' }, [
      el('b', {}, [label]),
      el('span', {}, [stateText]),
      el('div', { class: 'test-actions' }, [
        !r.rec && r.onPhone && r.meetingHere ? act(S.hostOne, 'data-host', async () => note(await hostOne(r.meetingId, deps))) : null,
        r.rec && !r.onPhone && r.meetingHere ? act(S.hostFetch, 'data-fetch', async () => h.toast((await fetchBack(r.meetingId, deps)) ? S.hostFetched : S.hostFailed)) : null,
        r.rec ? act(S.hostRemove, 'data-unhost', async () => {
          const gone = await unhost(r.meetingId, deps)
          if (gone) refused = false
          h.toast(gone ? S.hostRemoved : S.hostFailed)
        }) : null,
      ]),
    ])
  }

  function open(): void {
    const first = !showing()
    const body = el('div', { class: 'host-list' }, [el('p', { class: 'meta' }, [S.hostListLoading])])
    h.openSheet([
      el('h3', {}, [S.hostTitle]),
      el('p', { class: 'meta' }, [S.hostLead]),
      usageView(),
      allowanceView(),
      body,
      el('p', { class: 'foot' }, [S.hostRestore]),
      el('p', { class: 'foot' }, [S.hostRetention]),
    ])
    h.sheet.dataset.kind = SHEET_KIND
    void (async (): Promise<void> => {
      if (first) { await refreshUsage(); if (showing()) { open(); return } }
      const hs = readHosting(h.state())
      const rows = hs ? hostingRows(hs, await h.audio.entries(), meetings()) : []
      if (!showing()) return
      body.replaceChildren(...(rows.length ? rows.map(rowView) : [el('p', { class: 'meta' }, [S.hostNone])]))
    })()
  }

  function settingsGroup(): (HTMLElement | null)[] {
    if (!h.ctx.enabled()) return []
    const st = h.ctx.status()
    if (st === undefined) return []
    const head = el('h4', { class: 'eyebrow' }, [S.hostTitle])
    if (st === null) return [head, el('p', { class: 'meta', 'data-hosting': 'unknown' }, [S.setServerUnknown])]
    if (!st.hosted) return [head, el('p', { class: 'meta', 'data-hosting': 'off' }, [S.hostNotOn])]
    const on = isOn()
    if (on && !usage) void refreshUsage().then(() => { if (usage) h.redrawSettings() })
    return [
      head,
      el('button', {
        class: 'radio' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-hosting-toggle': '1',
        onclick: () => setOn(!on),
      }, [el('b', {}, [S.hostToggle]), el('small', {}, [S.hostToggleHint])]),
      on ? usageView() : null,
      on ? allowanceView() : null,
      el('button', { class: 'btn btn-ghost', 'data-hosting-open': '1', onclick: open }, [S.hostOpen]),
    ]
  }

  return {
    settingsGroup,
    open,
    afterKeep: (meetingId) => {
      void askPersist()
      if (!isOn() || !hosted()) return
      void hostOne(meetingId, deps).then((r) => { note(r); return refreshUsage() }).then(redraw)
    },
    removed: (meetingId) => { if (readHosting(h.state())?.recs.some((r) => r.meetingId === meetingId)) void unhost(meetingId, deps) },
    boot: () => { if (isOn()) void h.ctx.probe().then(() => hostWaiting()) },
  }
}
