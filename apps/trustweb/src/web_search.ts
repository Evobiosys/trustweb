/**
 * "Search the web instead" (wave 2, B8): below a search in TrustWeb, the same
 * words as a plain link to a web search engine the person picks. Results from
 * there are outside TrustWeb and untrusted, and the row says so.
 *
 * Nothing is requested before a tap: these are ordinary links (no prefetch, no
 * favicons or logos, which would themselves be requests to those hosts). A tap
 * opens a new tab with no opener and no referrer, so the search engine learns
 * the words and nothing about this page.
 */
import { el } from '../../demo/src/ui/dom'
import { SEARCH_ENGINES, SearchEngine } from './model'
import { S } from './strings'

const BASES: Readonly<Record<SearchEngine, string>> = {
  [SearchEngine.Google]: 'https://www.google.com/search?q=',
  [SearchEngine.Ecosia]: 'https://www.ecosia.org/search?q=',
  [SearchEngine.Qwant]: 'https://www.qwant.com/?q=',
  [SearchEngine.Brave]: 'https://search.brave.com/search?q=',
}

/** Longest query handed to an engine (the query dock takes 200 characters). */
const MAX_QUERY = 200

/** The engine's search URL for these words, or null when there are none. */
export function webSearchUrl(engine: SearchEngine, query: string): string | null {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY)
  return q ? BASES[engine] + encodeURIComponent(q) : null
}

export interface WebSearchRow {
  el: HTMLElement
  /** New words: the links follow; no words, the row hides. */
  update(query: string): void
}

/** The row: a title, "outside TrustWeb, untrusted results", and one link per engine. */
export function webSearchRow(query: string): WebSearchRow {
  const links = SEARCH_ENGINES.map((engine) => el('a', {
    class: 'chip web-engine', 'data-engine': engine, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
  }, [S.webSearchEngine[engine]]))
  const row = el('div', { class: 'web-search', 'data-web-search': '1', role: 'group', 'aria-label': S.webSearchTitle }, [
    el('p', { class: 'web-search-head' }, [el('b', {}, [S.webSearchTitle]), ' ', el('small', {}, [S.webSearchUntrusted])]),
    el('div', { class: 'chips' }, links),
  ])
  const update = (q: string): void => {
    row.hidden = webSearchUrl(SearchEngine.Google, q) === null
    links.forEach((a, i) => {
      const url = webSearchUrl(SEARCH_ENGINES[i], q)
      if (url) a.setAttribute('href', url)
      else a.removeAttribute('href')
    })
  }
  update(query)
  return { el: row, update }
}
