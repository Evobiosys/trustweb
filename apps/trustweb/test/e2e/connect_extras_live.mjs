// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c connect-extras (zeta) live check: the app's own reader (mastodon_tag.ts fetchMastodonTag) against the PUBLIC API of the default instance,
 * read-only (GET, no login, no cookies). Prints CORS, rate limit, underscore handling, and what the reader returns for an event tag and an existing tag.
 *   . /tmp/ipe_env.sh; cd apps/demo && ../../node_modules/.bin/tsx ../trustweb/test/e2e/connect_extras_live.mjs
 */
import { fetchMastodonTag, mastodonTagUrl } from '../../src/mastodon_tag.ts'
import { MASTODON_DEFAULT_INSTANCE } from '../../src/mastodon_default.ts'

const HOST = MASTODON_DEFAULT_INSTANCE
const ORIGIN = 'https://app.trustweb.one'
const probe = async (tag) => {
  const url = mastodonTagUrl(HOST, tag)
  const res = await fetch(url, { headers: { Origin: ORIGIN } })
  const h = (k) => res.headers.get(k)
  const body = await res.json().catch(() => null)
  return { url, status: res.status, cors: h('access-control-allow-origin'), rateLimit: `${h('x-ratelimit-remaining')}/${h('x-ratelimit-limit')} resets ${h('x-ratelimit-reset')}`, type: h('content-type'), raw: Array.isArray(body) ? body.length : typeof body }
}
const read = async (tag) => {
  const posts = await fetchMastodonTag(HOST, tag, fetch)
  return Array.isArray(posts) ? { posts: posts.length, first: posts[0] ? { who: posts[0].who, tag: posts[0].tag, context: posts[0].context, open: posts[0].open?.url, chars: posts[0].text.length } : null } : { problem: posts }
}
for (const tag of ['event_Winter_IYG', 'fediverse']) {
  console.log(`tag ${tag}`)
  console.log('  api    ', JSON.stringify(await probe(tag)))
  console.log('  reader ', JSON.stringify(await read(tag)))
}
const info = await (await fetch(`https://${HOST}/api/v1/tags/event_Winter_IYG`)).json()
console.log(`tag info: name=${info.name} url=${info.url} (the server lower-cases the tag in its url: underscore kept)`)
