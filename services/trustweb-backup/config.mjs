// Configuration of the hosted, transcribe and feedback features: options (tests) win over env, env over defaults.
// The old backup settings stay in server.mjs, unchanged.
//
// ENV (all optional; a feature whose settings are missing answers 503 not_configured)
//   HOSTED_DIR                       directory for hosted recordings (own dir, never BACKUP_DIR). Unset = hosting off.
//   HOSTED_MAX_BYTES                 2000000000   total hosted ciphertext on this server
//   HOSTED_MIN_FREE_BYTES            2000000000   refuse new hosted writes when the filesystem has less free (backups must never starve)
//   HOSTED_RETENTION_DAYS            90           the sweeper removes recordings untouched this long
//   ACCOUNT_SECONDS_LIMIT            36000        free plan: total declared seconds per account (10 x 1 h), a guard beside the recording count
//   ACCOUNT_BYTES_LIMIT              1000000000   free plan: total ciphertext bytes per account, a backstop (10 recordings x 30 MB = 300 MB is the real ceiling)
//   MAX_REC_BYTES                    30000000     one recording (1 h at ~67 kbps)
//   MAX_RECORDINGS                   10           THE free allowance: recordings per account (each up to 1 h); shown as used/limit
//   HOSTED_WRITES_PER_HOUR_PER_IP    60
//   ACCOUNT_CREATES_PER_IP_DAY       5            new accounts (first writes) per IP and UTC day
//   REC_GETS_PER_HOUR                30           downloads per recording per hour
//   MAX_CONCURRENT_UPLOADS           6
//   HOSTED_UPLOADS_PER_IP            2            uploads in flight per client (IPv6: per /64), so one client cannot hold every slot
//   UPLOAD_IDLE_MS                   30000        abort an upload that sends nothing for this long
//   LONG_REQUEST_MS                  900000       request deadline of /hosted and /transcribe (the short routes keep SHORT_REQUEST_MS)
//   SHORT_REQUEST_MS                 30000
//   TRANSCRIBE_PROVIDER              auto (default) | berget | openrouter | infomaniak
//                                    auto = Berget (Sweden) when its key is present, else OpenRouter; berget = Berget first; openrouter = OpenRouter alone
//   TRANSCRIBE_FALLBACK              openrouter (default when unset) | none; fails closed: any other value means none. Berget first: may OpenRouter (a PAID, US route) take over when Berget answers 5xx,
//                                    times out or is not configured? (never on a 4xx or a 429: those are not a Berget outage)
//   TRANSCRIBE_ENABLED               1 switches the berget/openrouter providers on (EnvironmentFile, written by scripts/trustweb_transcribe_switch_on.sh);
//                                    without it /transcribe answers 503 not_configured even when a key is loaded
//   BERGET_URL                       https://api.berget.ai/v1
//   OPENROUTER_URL                   https://openrouter.ai/api/v1
//   CREDENTIALS_DIRECTORY            set by systemd (LoadCredential=orkey:/etc/trustweb/orkey.json, LoadCredential=berget:/etc/trustweb/berget.json,
//                                    each only when the file exists); the keys are read from there
//   TRANSCRIBE_CREDENTIAL            orkey        <CREDENTIALS_DIRECTORY>/<this> = JSON {"key": "sk-or-..."} (OpenRouter); anything else = no key
//   TRANSCRIBE_BERGET_CREDENTIAL     berget       <CREDENTIALS_DIRECTORY>/<this> = JSON {"key": "..."} (Berget); anything else = no key
//   TRANSCRIBE_DATA_COLLECTION       deny         OpenRouter provider data policy sent with every call (deny | allow)
//   TRANSCRIBE_URL, TRANSCRIBE_KEY   (infomaniak only) provider endpoint (full POST URL incl. product id) and bearer token (EnvironmentFile 0600)
//   TRANSCRIBE_MODEL                 openai/whisper-large-v3-turbo (openrouter) | whisper (infomaniak)
//   TRANSCRIBE_BERGET_MODEL          Systran/faster-whisper-large-v3 (multilingual; kb-whisper-large is tuned for Swedish and the bare alias "whisper" means it)
//   TRANSCRIBE_BERGET_EUR_PER_SECOND 0.000033     Berget's published price (api.berget.ai/v1/models), only for the logged cost estimate
//   TRANSCRIBE_BERGET_TIMEOUT_MS     300000       one Berget call (then the fallback gets its own TRANSCRIBE_TIMEOUT_MS; queue wait + both stay inside Caddy's 15 min)
//   TRANSCRIBE_RESULTS_URL           (infomaniak) optional template with {batch_id}; derived from TRANSCRIBE_URL otherwise
//   TRANSCRIBE_POLL_MS               2000         (infomaniak)
//   TRANSCRIBE_TIMEOUT_MS            180000 (openrouter, one call; upstream cuts at ~60 s) | 600000 (infomaniak: submit + polling, in total)
//   TRANSCRIBE_DAILY_SECONDS         7200         everyone together, per UTC day
//   TRANSCRIBE_IP_DAILY_SECONDS      3600         per IP and UTC day
//   TRANSCRIBE_MAX_CONCURRENT        1            paid provider jobs at once (a job runs to its end even when the phone goes away)
//   TRANSCRIBE_UNCERTAIN_PER_DAY     3            failures that may still have been billed (gateway/timeout statuses) per UTC day before the day's budget closes
//   TRANSCRIBE_QUEUE                 2            callers that may wait for that slot (more: 429 busy before any audio is read)
//   TRANSCRIBE_QUEUE_WAIT_MS         240000       longest wait for the slot (then 429 busy): wait + job stay inside Caddy's 15 min
//   TRANSCRIBE_UPLOADS_PER_IP        1            audio uploads in flight per client (IPv6: per /64)
//   TRANSCRIBE_MAX_BYTES             21600000     1 h at 48 kbps
//   FEEDBACK_FILE                    path of the 0600 JSON-lines file. Unset = feedback off.
//   FEEDBACK_ORIGINS                 comma list, default https://idea2.site,https://app.idea2.site plus the TrustInTheWeb sites
//                                    (trustintheweb.org, trustintheweb.com, app.trustintheweb.org; production also sets it in a
//                                    systemd drop-in, scripts/trustweb_domains.sh backup-env)
//   FEEDBACK_MAX_BYTES               2000000
//   FEEDBACK_PER_HOUR                5            per IP
//   SUBSCRIBER_URL                   (unset = off) where a feedback entry with newsletter:true is forwarded, e.g. https://subscriber.questhub.eco/subscribe
//                                    (the production unit sets it; staging points it at a fake). Never from a request.
//   SUBSCRIBER_TIMEOUT_MS            4000         longest wait for the subscriber (the visitor gets 204 either way)
//   NEWSLETTER_PER_DAY               20           forwards per UTC day, all visitors together (attempts). The subscriber limits this
//                                                 server's one address to 3/min and 50/day; past this cap entries are kept with
//                                                 deferred:true for a replay instead of burning the subscriber's bucket
//   NEWSLETTER_PER_MINUTE            2            the same, per sliding minute (the subscriber: 3/min)
//   NEWSLETTER_PER_30_DAYS           240          the same, per sliding 30 days (the subscriber: 250/30 days; 20 a day would empty it in 12)
//   LINK_HOSTS                       comma list, default app.idea2.site,app.trustintheweb.org: the only hosts a stored connect link may point at
//                                    (and the only Origins POST /link accepts). Exact host match, no port, no userinfo.
//   LINKS_FILE                       the short-link store (JSON, 0600, atomic rewrite). Default <BACKUP_DIR>/links.json (the unit's state dir).
//   LINK_TTL_DAYS                    30           a short link answers 404 after this
//   LINK_MAX                         5000         stored links in total; beyond it POST /link answers 507 storage_full
//   LINK_MAX_BYTES                   2048         body cap of POST /link (413 above)
//   LINK_PER_MINUTE, LINK_PER_HOUR   6, 30        POST /link per network address (IPv6: /64), kept in memory, NOT anonymous
//   LINK_SWEEP_MS                    3600000      how often expired links are dropped (they are also dropped when read)
//   CONNECT_FILE                     the connect-code store (JSON, 0600, atomic rewrite). Default <BACKUP_DIR>/connect.json (wave 6b).
//   CONNECT_TTL_DAYS                 365          a connect code (and its username) expires this long after its last use
//   CONNECT_TOUCH_HOURS              24           an open refreshes the last use only when it is older than this (no file rewrite per open)
//   CONNECT_MAX                      20000        stored codes; beyond it a MINT answers 507 storage_full
//   CONNECT_MAX_BYTES                2048         body cap of POST /connect and POST /name (413 above)
//   CONNECT_PER_MINUTE, CONNECT_PER_HOUR          6, 30     POST /connect and POST /name together, per network address (IPv6: /64), in memory, NOT anonymous
//   CONNECT_GET_PER_MINUTE, CONNECT_GET_PER_HOUR  20, 300   GET /c/ and GET /who/ together, per network address (plain-text 429)
//   CONNECT_SWEEP_MS                 3600000      how often expired codes are dropped (they also act as unknown when read)

import fs from 'node:fs'
import path from 'node:path'

export const TranscribeProvider = Object.freeze({ Berget: 'berget', OpenRouter: 'openrouter', Infomaniak: 'infomaniak' })
/** The TRANSCRIBE_PROVIDER setting: the three providers plus "auto" (Berget when its key exists, else OpenRouter). */
const PROVIDER_AUTO = 'auto'
const FALLBACK_NONE = 'none'
const flag = (raw) => raw === '1' || raw === 'true'
/** What an API key may look like. Keeps a malformed credential (spaces, newlines, quotes) out of an Authorization header. */
export const KEY_SHAPE = /^[A-Za-z0-9_.~+-]{20,256}$/ // underscore included: Berget keys look like sk_ber_...

/**
 * A key from a systemd credential file: JSON {"key": "..."} at <CREDENTIALS_DIRECTORY>/<name> (the shape unfold-news's /api/orkey served).
 * Returns '' for a missing, unreadable or malformed credential. Never throws, never logs, never echoes the content.
 */
export function readCredential(name, env = process.env) {
  const dir = env.CREDENTIALS_DIRECTORY
  if (dir === undefined || dir === '') return ''
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return ''
  try {
    const key = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))?.key
    return typeof key === 'string' && KEY_SHAPE.test(key) ? key : ''
  } catch {
    return ''
  }
}

/** The transcription key: the credential named by TRANSCRIBE_CREDENTIAL (default orkey = OpenRouter; Berget passes its own name). */
export function readCredentialKey(env = process.env, name = env.TRANSCRIBE_CREDENTIAL ?? 'orkey') {
  return readCredential(name, env)
}

function pick(options, key, envName, fallback, parse = Number) {
  if (options[key] !== undefined) return options[key]
  const raw = process.env[envName]
  return raw === undefined || raw === '' ? fallback : parse(raw)
}

/**
 * Which providers serve /transcribe, in order, from the settings and the keys that exist. Pure: no I/O.
 *   auto / berget   Berget when its key exists; OpenRouter after it when the fallback is allowed (and its key exists),
 *                   or alone when Berget has no key and the setting is auto (the pre-Berget behaviour)
 *   openrouter      OpenRouter alone;  infomaniak: handled by the caller (one provider, own url and key)
 * Returns provider names, [] when nothing can serve.
 */
export function transcribeChain({ setting, fallback, bergetKey, openrouterKey }) {
  if (setting === TranscribeProvider.OpenRouter) return openrouterKey === '' ? [] : [TranscribeProvider.OpenRouter]
  const chain = bergetKey === '' ? [] : [TranscribeProvider.Berget]
  const openrouterAllowed = fallback !== FALLBACK_NONE || (setting === PROVIDER_AUTO && bergetKey === '')
  if (openrouterKey !== '' && openrouterAllowed) chain.push(TranscribeProvider.OpenRouter)
  return chain
}

const list = (raw) => raw.split(',').map((s) => s.trim()).filter(Boolean)
/** Where the website feedback form may post from: the idea2 pages and the TrustInTheWeb sites (wave 3). */
const DEFAULT_FEEDBACK_ORIGINS = 'https://idea2.site,https://app.idea2.site,https://trustintheweb.org,https://trustintheweb.com,https://app.trustintheweb.org'

/** Where a short connect link may point: the two app hosts (wave 5). */
const DEFAULT_LINK_HOSTS = 'app.idea2.site,app.trustintheweb.org'

export function loadConfig(options = {}) {
  const setting = pick(options, 'transcribeProvider', 'TRANSCRIBE_PROVIDER', PROVIDER_AUTO, String) // an unknown name is kept: /transcribe answers 503 for it
  const infomaniak = setting === TranscribeProvider.Infomaniak
  const transcribeUrl = pick(options, 'transcribeUrl', 'TRANSCRIBE_URL', '', String)
  // transcribeKey = the key of the OpenRouter provider (its credential) or, for infomaniak, the bearer token from the env file
  const transcribeKey = options.transcribeKey ?? (infomaniak ? pick(options, 'transcribeKey', 'TRANSCRIBE_KEY', '', String) : readCredentialKey())
  const bergetKey = options.bergetKey ?? readCredentialKey(process.env, process.env.TRANSCRIBE_BERGET_CREDENTIAL ?? 'berget')
  const transcribeEnabled = pick(options, 'transcribeEnabled', 'TRANSCRIBE_ENABLED', false, flag)
  // fails closed: only the exact word openrouter allows the paid US fallback, a typo (option or env) means none; unset = openrouter
  const transcribeFallbackSetting = pick(options, 'transcribeFallback', 'TRANSCRIBE_FALLBACK', TranscribeProvider.OpenRouter, String) === TranscribeProvider.OpenRouter ? TranscribeProvider.OpenRouter : FALLBACK_NONE
  const known = setting === PROVIDER_AUTO || setting === TranscribeProvider.Berget || setting === TranscribeProvider.OpenRouter
  const transcribeChainNames = known ? transcribeChain({ setting, fallback: transcribeFallbackSetting, bergetKey, openrouterKey: transcribeKey }) : []
  // The provider a status answer names: the one that would serve first, else what the setting points at (an honest "would be used").
  const transcribeProvider = infomaniak || !known ? setting : transcribeChainNames[0] ?? (setting === TranscribeProvider.OpenRouter ? TranscribeProvider.OpenRouter : TranscribeProvider.Berget)
  const transcribeConfigured = infomaniak
    ? transcribeKey !== '' && transcribeUrl !== ''
    : transcribeEnabled && transcribeChainNames.length > 0
  const feedbackFile = pick(options, 'feedbackFile', 'FEEDBACK_FILE', '', String)
  return {
    now: options.now ?? Date.now,
    freeBytes: options.freeBytes ?? null, // test hook: () => Promise<number> in place of statfs
    shortRequestMs: pick(options, 'shortRequestMs', 'SHORT_REQUEST_MS', 30000),
    longRequestMs: pick(options, 'longRequestMs', 'LONG_REQUEST_MS', 900000),

    hostedDir: pick(options, 'hostedDir', 'HOSTED_DIR', '', String),
    hostedMaxBytes: pick(options, 'hostedMaxBytes', 'HOSTED_MAX_BYTES', 2_000_000_000),
    hostedMinFreeBytes: pick(options, 'hostedMinFreeBytes', 'HOSTED_MIN_FREE_BYTES', 2_000_000_000),
    retentionDays: pick(options, 'retentionDays', 'HOSTED_RETENTION_DAYS', 90),
    accountSecondsLimit: pick(options, 'accountSecondsLimit', 'ACCOUNT_SECONDS_LIMIT', 36000),
    accountBytesLimit: pick(options, 'accountBytesLimit', 'ACCOUNT_BYTES_LIMIT', 1_000_000_000),
    maxRecSeconds: 3600,
    maxRecBytes: pick(options, 'maxRecBytes', 'MAX_REC_BYTES', 30_000_000),
    maxRecordings: pick(options, 'maxRecordings', 'MAX_RECORDINGS', 10),
    sanityBytesPerSecond: 16000,
    hostedWritesPerHourPerIp: pick(options, 'hostedWritesPerHourPerIp', 'HOSTED_WRITES_PER_HOUR_PER_IP', 60),
    accountCreatesPerIpDay: pick(options, 'accountCreatesPerIpDay', 'ACCOUNT_CREATES_PER_IP_DAY', 5),
    recGetsPerHour: pick(options, 'recGetsPerHour', 'REC_GETS_PER_HOUR', 30),
    maxConcurrentUploads: pick(options, 'maxConcurrentUploads', 'MAX_CONCURRENT_UPLOADS', 6),
    hostedUploadsPerIp: pick(options, 'hostedUploadsPerIp', 'HOSTED_UPLOADS_PER_IP', 2),
    uploadIdleMs: pick(options, 'uploadIdleMs', 'UPLOAD_IDLE_MS', 30000),

    transcribeProviderSetting: setting,
    transcribeProvider,
    transcribeChain: transcribeChainNames, // provider names, in order
    transcribeFallback: transcribeChainNames.length > 1 ? transcribeChainNames[1] : null,
    transcribeFallbackSetting,
    transcribeEnabled,
    transcribeUrl,
    transcribeKey,
    bergetKey,
    transcribeConfigured,
    bergetUrl: pick(options, 'bergetUrl', 'BERGET_URL', 'https://api.berget.ai/v1', String),
    transcribeBergetModel: pick(options, 'transcribeBergetModel', 'TRANSCRIBE_BERGET_MODEL', 'Systran/faster-whisper-large-v3', String),
    transcribeBergetEurPerSecond: pick(options, 'transcribeBergetEurPerSecond', 'TRANSCRIBE_BERGET_EUR_PER_SECOND', 0.000033),
    transcribeBergetTimeoutMs: pick(options, 'transcribeBergetTimeoutMs', 'TRANSCRIBE_BERGET_TIMEOUT_MS', 300000),
    openrouterUrl: pick(options, 'openrouterUrl', 'OPENROUTER_URL', 'https://openrouter.ai/api/v1', String),
    transcribeDataCollection: pick(options, 'transcribeDataCollection', 'TRANSCRIBE_DATA_COLLECTION', 'deny', (v) => (v === 'allow' ? 'allow' : 'deny')),
    transcribeModel: pick(options, 'transcribeModel', 'TRANSCRIBE_MODEL', infomaniak ? 'whisper' : 'openai/whisper-large-v3-turbo', String),
    transcribeResultsUrl: pick(options, 'transcribeResultsUrl', 'TRANSCRIBE_RESULTS_URL', '', String),
    transcribePollMs: pick(options, 'transcribePollMs', 'TRANSCRIBE_POLL_MS', 2000),
    transcribeTimeoutMs: pick(options, 'transcribeTimeoutMs', 'TRANSCRIBE_TIMEOUT_MS', infomaniak ? 600000 : 180000),
    transcribeDailySeconds: pick(options, 'transcribeDailySeconds', 'TRANSCRIBE_DAILY_SECONDS', 7200),
    transcribeIpDailySeconds: pick(options, 'transcribeIpDailySeconds', 'TRANSCRIBE_IP_DAILY_SECONDS', 3600),
    transcribeMaxConcurrent: pick(options, 'transcribeMaxConcurrent', 'TRANSCRIBE_MAX_CONCURRENT', 1),
    transcribeUncertainPerDay: pick(options, 'transcribeUncertainPerDay', 'TRANSCRIBE_UNCERTAIN_PER_DAY', 3),
    transcribeQueue: pick(options, 'transcribeQueue', 'TRANSCRIBE_QUEUE', 2),
    transcribeQueueWaitMs: pick(options, 'transcribeQueueWaitMs', 'TRANSCRIBE_QUEUE_WAIT_MS', 240000),
    transcribeUploadsPerIp: pick(options, 'transcribeUploadsPerIp', 'TRANSCRIBE_UPLOADS_PER_IP', 1),
    transcribeMaxBytes: pick(options, 'transcribeMaxBytes', 'TRANSCRIBE_MAX_BYTES', 21_600_000),

    feedbackFile,
    feedbackConfigured: feedbackFile !== '',
    feedbackOrigins: options.feedbackOrigins ?? list(process.env.FEEDBACK_ORIGINS ?? DEFAULT_FEEDBACK_ORIGINS),
    feedbackMaxBytes: pick(options, 'feedbackMaxBytes', 'FEEDBACK_MAX_BYTES', 2_000_000),
    feedbackPerHour: pick(options, 'feedbackPerHour', 'FEEDBACK_PER_HOUR', 5),
    subscriberUrl: pick(options, 'subscriberUrl', 'SUBSCRIBER_URL', '', String),
    subscriberTimeoutMs: pick(options, 'subscriberTimeoutMs', 'SUBSCRIBER_TIMEOUT_MS', 4000),
    newsletterPerDay: pick(options, 'newsletterPerDay', 'NEWSLETTER_PER_DAY', 20),
    newsletterPerMinute: pick(options, 'newsletterPerMinute', 'NEWSLETTER_PER_MINUTE', 2),
    newsletterPer30Days: pick(options, 'newsletterPer30Days', 'NEWSLETTER_PER_30_DAYS', 240),

    linkHosts: (options.linkHosts ?? list(process.env.LINK_HOSTS ?? DEFAULT_LINK_HOSTS)).map((h) => h.toLowerCase()),
    linksFile: pick(options, 'linksFile', 'LINKS_FILE', '', String),
    linkTtlMs: pick(options, 'linkTtlDays', 'LINK_TTL_DAYS', 30) * 86_400_000,
    linkMax: pick(options, 'linkMax', 'LINK_MAX', 5000),
    linkMaxBytes: pick(options, 'linkMaxBytes', 'LINK_MAX_BYTES', 2048),
    linkPerMinute: pick(options, 'linkPerMinute', 'LINK_PER_MINUTE', 6),
    linkPerHour: pick(options, 'linkPerHour', 'LINK_PER_HOUR', 30),
    linkSweepMs: pick(options, 'linkSweepMs', 'LINK_SWEEP_MS', 3_600_000),

    connectFile: pick(options, 'connectFile', 'CONNECT_FILE', '', String),
    connectTtlMs: pick(options, 'connectTtlDays', 'CONNECT_TTL_DAYS', 365) * 86_400_000,
    connectTouchMs: pick(options, 'connectTouchHours', 'CONNECT_TOUCH_HOURS', 24) * 3_600_000,
    connectMax: pick(options, 'connectMax', 'CONNECT_MAX', 20000),
    connectMaxBytes: pick(options, 'connectMaxBytes', 'CONNECT_MAX_BYTES', 2048),
    connectPerMinute: pick(options, 'connectPerMinute', 'CONNECT_PER_MINUTE', 6),
    connectPerHour: pick(options, 'connectPerHour', 'CONNECT_PER_HOUR', 30),
    connectGetPerMinute: pick(options, 'connectGetPerMinute', 'CONNECT_GET_PER_MINUTE', 20),
    connectGetPerHour: pick(options, 'connectGetPerHour', 'CONNECT_GET_PER_HOUR', 300),
    connectSweepMs: pick(options, 'connectSweepMs', 'CONNECT_SWEEP_MS', 3_600_000),
  }
}
