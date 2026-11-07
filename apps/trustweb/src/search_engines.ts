// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The engines "Also search online" can open (wave 31): pure and DOM-free. The choice persists in the record as `askEngine`. */

export interface OnlineEngine { id: string; name: string; base: string; private?: true; advanced?: true }

export const ENGINES: readonly OnlineEngine[] = [
  { id: 'ecosia', name: 'Ecosia', base: 'https://www.ecosia.org/search?q=' },
  { id: 'qwant', name: 'Qwant', base: 'https://www.qwant.com/?q=' },
  { id: 'metager', name: 'MetaGer', base: 'https://metager.org/meta/meta.ger3?eingabe=', private: true },
  { id: 'mojeek', name: 'Mojeek', base: 'https://www.mojeek.com/search?q=' },
  { id: 'brave', name: 'Brave Search', base: 'https://search.brave.com/search?q=' },
  { id: 'startpage', name: 'Startpage', base: 'https://www.startpage.com/do/search?q=', private: true },
  { id: 'duckduckgo', name: 'DuckDuckGo', base: 'https://duckduckgo.com/?q=', private: true },
  { id: 'google', name: 'Google', base: 'https://www.google.com/search?q=', advanced: true },
  { id: 'perplexity', name: 'Perplexity', base: 'https://www.perplexity.ai/search?q=', advanced: true },
  { id: 'bing', name: 'Bing', base: 'https://www.bing.com/search?q=', advanced: true },
]

export const DEFAULT_ENGINE = 'ecosia'

/** The engine for an id; Ecosia for an absent or unknown one. */
export function engineById(id: string | undefined): OnlineEngine {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0]
}

export const isAdvanced = (id: string): boolean => engineById(id).advanced === true

/** The search page of this engine for these words (no words: its search page, empty). */
export function engineUrl(id: string | undefined, query: string): string {
  return engineById(id).base + encodeURIComponent(query.trim())
}
