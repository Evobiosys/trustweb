// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39: the module contract (docs: DEVLOG/wave39/SPEC-extensions-module-interface.txt). A module is one folder S/ext/<id>/, registered in one
 * line, loadable lazily (`heavy`) and removable without touching main.ts. Pure, no DOM at import time.
 */
import type { Actions } from '../actions'
import type { AppState } from '../model'
import type { S } from '../strings'
import type { ProfileId, TwSettings } from './profiles'
import { setToggle, switchProfile } from './profiles'

export interface TwBus {
  on(event: string, fn: (data?: unknown) => void): () => void
  emit(event: string, data?: unknown): void
}

/** What the host app hands a module; modules never import main.ts. Existing objects, no new store. */
export interface TwCtx {
  store: () => AppState
  strings: typeof S
  bus: TwBus
  navigate: (viewId: string) => void
  profile: () => ProfileId
  /** Wave 40: the app's regular chats (newest first); a module may list them. A tap on one emits 'open-chat' with the person id. */
  chats?: () => { id: string; title: string; last: string; unread: number }[]
  /** Wave 40 ai-edit-chat: every step a person can tap, as undoable commands (actions.ts); absent in hosts that have none. */
  actions?: Actions
  /** Wave 40: the screen or page the person is on, in plain words. */
  where?: () => string
}

export interface TwView { id: string; title: string; icon: string; mount(host: HTMLElement, ctx: TwCtx): () => void }

/** A block of rows a module adds under Settings > General > Extensions. */
export interface TwSettingsSection { id: string; title: string; rows: () => Node[] }

/** What a heavy module's dynamic import yields; merged over the registered stub. */
export type TwModuleBody = Pick<TwModule, 'views' | 'settings' | 'init' | 'dispose'>

export interface TwModule {
  /** kebab, unique, = folder name S/ext/<id>/ */
  id: string
  title: string
  /** One line for Settings > Extensions: what it does. */
  description?: string
  kind: 'view' | 'settings' | 'service' | 'skin'
  enabledByDefault: boolean
  /** true => never imported until enabled: `load` is the dynamic import(). */
  heavy?: boolean
  load?: () => Promise<TwModuleBody>
  /** The module is read once at load (not initialised live): switching it needs one reload. */
  reload?: boolean
  views?: TwView[]
  settings?: (ctx: TwCtx) => TwSettingsSection[]
  init?(ctx: TwCtx): void | Promise<void>
  /** Must undo everything init did (listeners, timers, DOM). */
  dispose?(): void
}

export function createBus(): TwBus {
  const subs = new Map<string, Set<(data?: unknown) => void>>()
  return {
    on(event, fn) {
      const set = subs.get(event) ?? new Set()
      set.add(fn)
      subs.set(event, set)
      return () => { set.delete(fn) }
    },
    emit(event, data) { for (const fn of [...(subs.get(event) ?? [])]) fn(data) },
  }
}

export interface RegistryIo {
  settings: () => TwSettings | undefined
  save: (next: TwSettings) => void
  ctx: () => TwCtx
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function createRegistry(io: RegistryIo) {
  const modules: TwModule[] = []
  const active = new Map<string, TwModule>()
  const loaded = new Map<string, TwModule>()
  let booted: Record<string, boolean> = {}

  const find = (id: string): TwModule | undefined => modules.find((m) => m.id === id)
  const isEnabled = (id: string): boolean => { const m = find(id); return m ? io.settings()?.extensions?.[id] ?? m.enabledByDefault : false }

  async function resolve(m: TwModule): Promise<TwModule> {
    if (!m.heavy || !m.load) return m
    let r = loaded.get(m.id)
    if (!r) { r = { ...m, ...(await m.load()) }; loaded.set(m.id, r) }
    return r
  }

  function disposeOne(id: string): void {
    const m = active.get(id)
    active.delete(id)
    try { m?.dispose?.() } catch (e) { console.error(`module ${id}: dispose failed`, e) }
  }

  /** Brings the running modules in line with the switches: the ones now off are disposed (reverse order), the ones now on initialised. */
  async function syncOnce(): Promise<void> {
    for (const m of [...modules].reverse()) if (active.has(m.id) && !isEnabled(m.id)) disposeOne(m.id)
    for (const m of modules) {
      if (active.has(m.id) || !isEnabled(m.id)) continue
      try {
        const r = await resolve(m)
        if (!isEnabled(m.id)) continue   // switched off while it loaded: never initialised
        await r.init?.(io.ctx())
        active.set(m.id, r)
        if (!isEnabled(m.id)) disposeOne(m.id)   // switched off while it initialised: undo it at once
      } catch (e) { console.error(`module ${m.id}: init failed`, e) }
    }
  }
  /** Wave 39 review: one sync at a time (a second call waits for the first, then runs once more), so a module is never initialised twice. */
  let queue: Promise<void> = Promise.resolve()
  function sync(): Promise<void> {
    queue = queue.then(syncOnce, syncOnce)
    return queue
  }

  return {
    registerModule(m: TwModule): void {
      if (!KEBAB.test(m.id)) throw new Error(`module id must be kebab-case: ${m.id}`)
      if (find(m.id)) throw new Error(`module already registered: ${m.id}`)
      modules.push(m)
    },
    listModules: (): readonly TwModule[] => [...modules],
    isEnabled,
    /** Wave 40 review: the module is initialised and running (a switch can be on while its chunk failed to load). */
    isActive: (id: string): boolean => active.has(id),
    /** Persists the switch and brings the module up or down at once. */
    async setEnabled(id: string, on: boolean): Promise<void> {
      if (!find(id)) throw new Error(`unknown module: ${id}`)
      io.save(setToggle(io.settings(), id, on))
      await sync()
    },
    /** Makes `to` the profile (switches kept per profile) and syncs. */
    async setProfile(to: ProfileId): Promise<void> {
      io.save(switchProfile(io.settings(), to, Object.fromEntries(modules.map((m) => [m.id, m.enabledByDefault]))))
      await sync()
    },
    sync,
    async start(): Promise<void> {
      booted = Object.fromEntries(modules.map((m) => [m.id, isEnabled(m.id)]))
      await sync()
    },
    stop(): void { for (const m of [...modules].reverse()) if (active.has(m.id)) disposeOne(m.id) },
    /** Modules read once at load whose switch changed since: one reload applies them. */
    needsReload: (): string[] => modules.filter((m) => m.reload && m.id in booted && booted[m.id] !== isEnabled(m.id)).map((m) => m.id),
    views: (): TwView[] => modules.flatMap((m) => (isEnabled(m.id) ? active.get(m.id) ?? (m.heavy ? undefined : m) : undefined)?.views ?? []),
    settingsSections: (): TwSettingsSection[] => [...active.values()].filter((m) => isEnabled(m.id)).flatMap((m) => m.settings?.(io.ctx()) ?? []),
  }
}
