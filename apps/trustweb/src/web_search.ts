/**
 * "Search the web instead" (wave 2, B8): below a search in TrustWeb, the same
 * words as a plain link to a web search engine the person picks. Results from
 * there are outside TrustWeb and untrusted, and the row says so.
 *
 * Nothing is requested before a tap: these are ordinary links (no prefetch, no
 * favicons or logos, which would themselves be requests to those hosts). A tap
 * opens a new tab with no opener and no referrer, so the search engine learns
 * the words and nothing about this page.
 *
 * Wave 3: where our server has an engine with an official API and a key
 * (GET /websearch/engines, web_results.ts), a "Show results here" button
 * below the links fetches that engine's results through our server, after a
 * tap and a once-per-engine yes; they are listed as text under the binding
 * label "Outside TrustWeb, untrusted results, via <engine>". Fetched results
 * live here per visit, keyed by the words, so a redraw never fetches again.
 */
import { el } from '../../demo/src/ui/dom'
import { SEARCH_ENGINES, SearchEngine } from './model'
import { S } from './strings'
import { fetchEngines, searchWeb, webQuery, WebSearchError } from './web_results'
import type { WebEngine, WebSearchOutcome } from './web_results'

const BASES: Readonly<Record<SearchEngine, string>> = {
  [SearchEngine.Google]: 'https://www.google.com/search?q=',
  [SearchEngine.Ecosia]: 'https://www.ecosia.org/search?q=',
  [SearchEngine.Qwant]: 'https://www.qwant.com/?q=',
  [SearchEngine.Brave]: 'https://search.brave.com/search?q=',
}

/** The results panel's "Search on <engine> yourself": the link-outs above, plus the engines that only answer inside the app. */
const LINK_OUT: ReadonlyMap<string, string> = new Map([...Object.entries(BASES), ['mojeek', 'https://www.mojeek.com/search?q=']])

/** Engines whose terms ask for "Powered by <engine>" where their results are shown (websearch contract section 3). */
const ATTRIBUTION: ReadonlySet<string> = new Set(['brave'])

/** The engine's search URL for these words, or null when there are none. */
export function webSearchUrl(engine: SearchEngine, query: string): string | null {
  const q = webQuery(query)
  return q ? BASES[engine] + encodeURIComponent(q) : null
}

/** "Search on <engine> yourself" for any engine id this build knows a search page of; null otherwise. */
export function engineLinkUrl(engineId: string, query: string): string | null {
  const q = webQuery(query)
  const base = LINK_OUT.get(engineId)
  return q && base ? base + encodeURIComponent(q) : null
}

export interface WebSearchRow {
  el: HTMLElement
  /** New words: the links follow; no words, the row hides. */
  update(query: string): void
}

/** What the row needs from the app for results inside it (wave 3). */
export interface WebResultsHooks {
  /** Results inside the app may be offered here at all (the real app, not a demo phone). */
  enabled: () => boolean
  consented: (engineId: string) => boolean
  /** Remembers the yes for this engine (and saves). */
  consent: (engineId: string) => void
}

enum Phase {
  /** The once-per-engine yes is on screen. */
  Asking = 'asking',
  Loading = 'loading',
  Done = 'done',
}

interface Panel {
  q: string
  engine: WebEngine
  phase: Phase
  outcome?: WebSearchOutcome
}

/** Per visit: the engine list (asked once), the engine picked, the one panel (for one set of words). */
let engines: WebEngine[] | null = null
let asking = false
let picked: string | null = null
let panel: Panel | null = null
const rows = new Set<{ el: HTMLElement; draw: () => void }>()

/** Forgets the rows a render replaced (they are off screen for good). */
function prune(): void {
  for (const r of [...rows]) if (!r.el.isConnected) rows.delete(r)
}

/** Redraws every row still on screen; forgets the ones a render replaced. */
function redrawAll(): void {
  prune()
  for (const r of rows) r.draw()
}

function loadEngines(): void {
  if (engines !== null || asking) return
  asking = true
  void fetchEngines().then((list) => { engines = list; asking = false; redrawAll() })
}

function currentEngine(list: readonly WebEngine[]): WebEngine {
  return list.find((e) => e.id === picked) ?? list[0]
}

function run(q: string, engine: WebEngine): void {
  const mine: Panel = { q, engine, phase: Phase.Loading }
  panel = mine
  redrawAll()
  void searchWeb(engine, q).then((outcome) => {
    // A 503 not_configured hides the button for that engine (contract section 1).
    if (!outcome.ok && outcome.error === WebSearchError.NotConfigured) engines = (engines ?? []).filter((e) => e.id !== engine.id)
    if (panel !== mine) return
    mine.phase = Phase.Done
    mine.outcome = outcome
    redrawAll()
  })
}

const linkAttrs = { target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }

function yourself(engine: WebEngine, q: string): HTMLElement | null {
  const href = engineLinkUrl(engine.id, q)
  return href ? el('a', { class: 'web-results-out', href, ...linkAttrs, 'data-web-results-out': engine.id }, [S.webResultsYourself(engine.label)]) : null
}

/** The panel for one finished search: the binding label, the results as text, the way out. */
function resultsView(p: Panel): HTMLElement {
  const engine = p.outcome?.ok ? p.outcome.engine : p.engine
  const body: (HTMLElement | null)[] = []
  if (p.phase === Phase.Loading) body.push(el('p', { class: 'meta', 'data-web-results-loading': '1' }, [S.webResultsLoading(engine.label)]))
  else if (p.outcome && !p.outcome.ok) body.push(el('p', { class: 'warn', 'data-web-results-error': p.outcome.error }, [S.webResultsError[p.outcome.error]]))
  else if (p.outcome?.ok && !p.outcome.results.length) body.push(el('p', { class: 'meta', 'data-web-results-empty': '1' }, [S.webResultsEmpty(engine.label)]))
  else if (p.outcome?.ok) {
    body.push(el('ol', { class: 'web-results-list' }, p.outcome.results.map((r) => el('li', { class: 'web-result' }, [
      el('a', { href: r.url, ...linkAttrs }, [r.title]),
      el('small', { class: 'web-result-host' }, [r.host]),
      r.snippet ? el('p', {}, [r.snippet]) : null,
    ]))))
  }
  return el('div', { class: 'web-results', 'data-web-results': engine.id, 'aria-live': 'polite' }, [
    el('p', { class: 'web-search-head' }, [el('b', {}, [S.webResultsVia(engine.label)]), el('small', {}, [S.webResultsSent(engine.label)])]),
    ...body,
    el('p', { class: 'web-results-foot' }, [
      yourself(engine, p.q),
      ATTRIBUTION.has(engine.id) ? el('small', { class: 'web-results-powered' }, [S.webResultsPoweredBy(engine.label)]) : null,
    ]),
  ])
}

/** The once-per-engine yes, in place (contract section 4). */
function consentView(p: Panel, hooks: WebResultsHooks): HTMLElement {
  return el('div', { class: 'web-results', 'data-web-consent': p.engine.id }, [
    el('p', { class: 'web-search-head' }, [el('b', {}, [S.webResultsConsent(p.engine.label)])]),
    el('div', { class: 'chips' }, [
      el('button', { class: 'btn btn-electric btn-sm', 'data-web-consent-yes': '1', onclick: () => { hooks.consent(p.engine.id); run(p.q, p.engine) } }, [S.webResultsContinue]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-web-consent-no': '1', onclick: () => { panel = null; redrawAll() } }, [S.webResultsNotNow]),
    ]),
  ])
}

/** The engine picker (only with two or more) and "Show results here". */
function showView(q: string, list: readonly WebEngine[], hooks: WebResultsHooks): HTMLElement {
  const engine = currentEngine(list)
  const pick = list.length > 1
    ? [el('span', { class: 'chips-lbl' }, [S.webResultsFrom]), ...list.map((e) => el('button', {
        class: 'chip' + (e.id === engine.id ? ' on' : ''), 'aria-pressed': String(e.id === engine.id), 'data-web-results-engine': e.id,
        onclick: () => { picked = e.id; redrawAll() },
      }, [e.label]))]
    : []
  const show = el('button', {
    class: 'btn btn-ghost btn-sm', 'data-web-results-show': engine.id,
    onclick: () => {
      if (hooks.consented(engine.id)) { run(q, engine); return }
      panel = { q, engine, phase: Phase.Asking }
      redrawAll()
    },
  }, [S.webResultsShow])
  return el('div', { class: 'chips web-results-show' }, [...pick, show])
}

/** The row: a title, "outside TrustWeb, untrusted results", one link per engine, and (wave 3) results inside the app. */
export function webSearchRow(query: string, hooks?: WebResultsHooks): WebSearchRow {
  const links = SEARCH_ENGINES.map((engine) => el('a', {
    class: 'chip web-engine', 'data-engine': engine, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
  }, [S.webSearchEngine[engine]]))
  const slot = el('div', { class: 'web-results-slot' })
  const row = el('div', { class: 'web-search', 'data-web-search': '1', role: 'group', 'aria-label': S.webSearchTitle }, [
    el('p', { class: 'web-search-head' }, [el('b', {}, [S.webSearchTitle]), ' ', el('small', {}, [S.webSearchUntrusted])]),
    el('div', { class: 'chips' }, links),
    slot,
  ])
  let words = query
  const draw = (): void => {
    const q = webQuery(words)
    const list = engines ?? []
    if (!hooks?.enabled() || !q || !list.length) { slot.replaceChildren(); return }
    const mine = panel?.q === q ? panel : null
    if (mine?.phase === Phase.Asking) slot.replaceChildren(consentView(mine, hooks))
    else if (mine) slot.replaceChildren(showView(q, list, hooks), resultsView(mine))
    else slot.replaceChildren(showView(q, list, hooks))
  }
  const update = (q: string): void => {
    const before = webQuery(words)
    words = q
    // This row's words changed: what was found for the old ones goes (it is not about these words).
    if (panel?.q === before && before !== webQuery(q)) panel = null
    row.hidden = webSearchUrl(SearchEngine.Google, q) === null
    links.forEach((a, i) => {
      const url = webSearchUrl(SEARCH_ENGINES[i], q)
      if (url) a.setAttribute('href', url)
      else a.removeAttribute('href')
    })
    draw()
  }
  if (hooks?.enabled()) {
    // Every render makes new rows: drop the replaced ones once this render is on screen (not before: a row made
    // earlier in the same render is not attached yet), so a long visit without a tap keeps none.
    queueMicrotask(prune)
    rows.add({ el: row, draw })
    loadEngines()
  }
  update(query)
  return { el: row, update }
}
