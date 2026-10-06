import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyCrm, isAppState, isCrmState } from '../../src/model'
import { sampleApp, sampleCrm } from '../../src/sample'
import {
  CRM_PREFIX, TRUSTWEB_KEY, clearImported, crmKey, loadCrm, parseImport, readImported, readTrustWeb, saveCrm, saveImported,
} from '../../src/storage'

const NOW = Date.UTC(2026, 9, 6, 12)

class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string): void { this.m.set(k, v) }
  removeItem(k: string): void { this.m.delete(k) }
  keys(): string[] { return [...this.m.keys()] }
}

let store: MemoryStorage

beforeEach(() => {
  store = new MemoryStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = store
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('storage', () => {
  it('reads TrustWeb\'s record only when it looks like one, and never writes it', () => {
    expect(readTrustWeb()).toBeNull()
    store.setItem(TRUSTWEB_KEY, JSON.stringify({ v: 2, me: {} }))
    expect(readTrustWeb()).toBeNull()
    store.setItem(TRUSTWEB_KEY, JSON.stringify(sampleApp(NOW)))
    expect(readTrustWeb()!.people.length).toBe(7)
    saveCrm('me', sampleCrm(NOW))
    saveImported(sampleApp(NOW))
    expect(store.getItem(TRUSTWEB_KEY)).toBe(JSON.stringify(sampleApp(NOW)))
    for (const k of store.keys()) expect(k === TRUSTWEB_KEY || k.startsWith(CRM_PREFIX)).toBe(true)
  })

  it('accepts a bare AppState or a backup payload, refuses the rest', () => {
    const app = sampleApp(NOW)
    expect(parseImport(JSON.stringify(app))!.me.displayName).toBe('Sample')
    expect(parseImport(JSON.stringify({ v: 1, at: NOW, data: app }))!.people.length).toBe(7)
    expect(parseImport('not json')).toBeNull()
    expect(parseImport(JSON.stringify({ hello: 'world' }))).toBeNull()
    expect(parseImport(JSON.stringify({ v: 1, at: NOW, data: { v: 1 } }))).toBeNull()
  })

  it('round-trips an import and forgets it', () => {
    expect(readImported()).toBeNull()
    expect(saveImported(sampleApp(NOW))).toBe(true)
    expect(readImported()!.people[0].id).toBe('p-lena')
    clearImported()
    expect(readImported()).toBeNull()
  })

  it('round-trips the CRM record per persona and falls back to empty', () => {
    expect(loadCrm('me')).toEqual(emptyCrm())
    saveCrm('me', sampleCrm(NOW))
    expect(loadCrm('me').interactions.length).toBe(4)
    expect(loadCrm('other')).toEqual(emptyCrm())
    expect(crmKey('Bad Persona!')).toBe(CRM_PREFIX + 'me')
    store.setItem(crmKey('me'), '{"v":1}')
    expect(loadCrm('me')).toEqual(emptyCrm())
  })

  it('survives a browser that blocks storage', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem(): never { throw new Error('blocked') },
      setItem(): never { throw new Error('blocked') },
      removeItem(): never { throw new Error('blocked') },
    }
    expect(readTrustWeb()).toBeNull()
    expect(loadCrm('me')).toEqual(emptyCrm())
    expect(saveCrm('me', emptyCrm())).toBe(false)
    expect(() => clearImported()).not.toThrow()
  })

  it('type guards', () => {
    expect(isAppState(sampleApp(NOW))).toBe(true)
    expect(isAppState({ v: 1 })).toBe(false)
    expect(isCrmState(sampleCrm(NOW))).toBe(true)
    expect(isCrmState({ v: 1, interactions: [] })).toBe(false)
  })
})
