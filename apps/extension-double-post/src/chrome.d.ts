// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Minimal typing for the few extension APIs used (no @types/chrome dependency).
declare const chrome: {
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } }
  permissions: { request(p: { origins: string[] }): Promise<boolean>; remove(p: { origins: string[] }): Promise<boolean> }
  scripting: {
    registerContentScripts(s: { id: string; matches: string[]; js: string[]; runAt: string }[]): Promise<void>
    getRegisteredContentScripts(): Promise<{ id: string; matches: string[] }[]>
    unregisterContentScripts(f: { ids: string[] }): Promise<void>
  }
}
