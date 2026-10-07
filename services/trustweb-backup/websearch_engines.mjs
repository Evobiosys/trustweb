// The engine table of /websearch. Only engines with a DOCUMENTED, OFFICIAL, key-based API get an adapter (mode "api").
// The others are listed as "link_only" so the app never guesses (research: report search-api_of-trustweb, 2026-10-07).
// An adapter is data + two pure functions: request(q, key, cfg) -> {url, headers}, parse(json) -> raw candidates [{title,url,snippet}].
// Keys live in the systemd credential directory (websearch-<id>), never in env or a script. The key never appears in an answer or a log.

export const EngineMode = Object.freeze({ Api: 'api', LinkOnly: 'link_only' })

/** @typedef {{id:string,label:string,mode:string,credential?:string,dailyCap?:number,request?:Function,parse?:Function}} Engine */

const BRAVE = {
  id: 'brave',
  label: 'Brave',
  mode: EngineMode.Api,
  credential: 'websearch-brave',
  // Brave (Sep 2026): USD 5 of free credit per month = about 1000 queries at USD 5 per 1000; the cap keeps a day under a thirtieth of it.
  dailyCap: 30,
  request: (q, key, cfg) => {
    const url = new URL(cfg.websearchBraveUrl)
    url.searchParams.set('q', q)
    url.searchParams.set('count', '10')
    url.searchParams.set('safesearch', 'moderate')
    url.searchParams.set('text_decorations', 'false')
    return { url: url.href, headers: { 'X-Subscription-Token': key } }
  },
  parse: (json) =>
    Array.isArray(json?.web?.results) ? json.web.results.map((r) => ({ title: r?.title, url: r?.url, snippet: r?.description })) : null,
}

const MOJEEK = {
  id: 'mojeek',
  label: 'Mojeek',
  mode: EngineMode.Api,
  credential: 'websearch-mojeek',
  // Mojeek: pay as you go from GBP 1 per 1000 queries (Personal), free trial on request. Cap = a modest daily spend.
  dailyCap: 200,
  request: (q, key, cfg) => {
    const url = new URL(cfg.websearchMojeekUrl)
    url.searchParams.set('q', q)
    url.searchParams.set('fmt', 'json')
    url.searchParams.set('t', '10')
    url.searchParams.set('api_key', key)
    return { url: url.href, headers: {} }
  },
  parse: (json) => {
    const body = json?.response
    if (body === null || typeof body !== 'object' || (body.status !== undefined && body.status !== 'OK')) return null
    return Array.isArray(body.results) ? body.results.map((r) => ({ title: r?.title, url: r?.url, snippet: r?.desc })) : null
  },
}

const linkOnly = (id, label) => ({ id, label, mode: EngineMode.LinkOnly })

export const ENGINES = Object.freeze([
  BRAVE,
  MOJEEK,
  linkOnly('qwant', 'Qwant'),
  linkOnly('ecosia', 'Ecosia'),
  linkOnly('metager', 'MetaGer'),
  linkOnly('swisscows', 'Swisscows'),
])

export const engineById = (id) => ENGINES.find((e) => e.id === id)
