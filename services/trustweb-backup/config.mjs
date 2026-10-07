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
//   TRANSCRIBE_PROVIDER              openrouter (default) | infomaniak
//   TRANSCRIBE_ENABLED               1 switches the openrouter provider on (EnvironmentFile, written by scripts/trustweb_transcribe_switch_on.sh);
//                                    without it /transcribe answers 503 not_configured even when the key is loaded
//   OPENROUTER_URL                   https://openrouter.ai/api/v1
//   CREDENTIALS_DIRECTORY            set by systemd (LoadCredential=orkey:/etc/unfold-news/orkey.json); the openrouter key is read
//   TRANSCRIBE_CREDENTIAL            orkey        from <CREDENTIALS_DIRECTORY>/<this> = JSON {"key": "sk-or-..."}; anything else = no key
//   TRANSCRIBE_DATA_COLLECTION       deny         OpenRouter provider data policy sent with every call (deny | allow)
//   TRANSCRIBE_URL, TRANSCRIBE_KEY   (infomaniak only) provider endpoint (full POST URL incl. product id) and bearer token (EnvironmentFile 0600)
//   TRANSCRIBE_MODEL                 openai/whisper-large-v3-turbo (openrouter) | whisper (infomaniak)
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

import fs from 'node:fs'
import path from 'node:path'

export const TranscribeProvider = Object.freeze({ OpenRouter: 'openrouter', Infomaniak: 'infomaniak' })
const flag = (raw) => raw === '1' || raw === 'true'
/** What an API key may look like. Keeps a malformed credential (spaces, newlines, quotes) out of an Authorization header. */
const KEY_SHAPE = /^[A-Za-z0-9._~+-]{20,256}$/

/**
 * The OpenRouter key from the systemd credential: a JSON file {"key": "..."} (the shape unfold-news's /api/orkey served).
 * Returns '' for a missing, unreadable or malformed credential. Never throws, never logs, never echoes the content.
 */
export function readCredentialKey(env = process.env) {
  const dir = env.CREDENTIALS_DIRECTORY
  if (dir === undefined || dir === '') return ''
  const name = env.TRANSCRIBE_CREDENTIAL ?? 'orkey'
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return ''
  try {
    const key = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))?.key
    return typeof key === 'string' && KEY_SHAPE.test(key) ? key : ''
  } catch {
    return ''
  }
}

function pick(options, key, envName, fallback, parse = Number) {
  if (options[key] !== undefined) return options[key]
  const raw = process.env[envName]
  return raw === undefined || raw === '' ? fallback : parse(raw)
}

const list = (raw) => raw.split(',').map((s) => s.trim()).filter(Boolean)
/** Where the website feedback form may post from: the idea2 pages and the TrustInTheWeb sites (wave 3). */
const DEFAULT_FEEDBACK_ORIGINS = 'https://idea2.site,https://app.idea2.site,https://trustintheweb.org,https://trustintheweb.com,https://app.trustintheweb.org'

export function loadConfig(options = {}) {
  const transcribeProvider = pick(options, 'transcribeProvider', 'TRANSCRIBE_PROVIDER', TranscribeProvider.OpenRouter, String)
  const openrouter = transcribeProvider === TranscribeProvider.OpenRouter
  const transcribeUrl = pick(options, 'transcribeUrl', 'TRANSCRIBE_URL', '', String)
  const transcribeKey = options.transcribeKey ?? (openrouter ? readCredentialKey() : pick(options, 'transcribeKey', 'TRANSCRIBE_KEY', '', String))
  const transcribeEnabled = pick(options, 'transcribeEnabled', 'TRANSCRIBE_ENABLED', false, flag)
  const transcribeConfigured =
    transcribeKey !== '' &&
    (openrouter ? transcribeEnabled : transcribeProvider === TranscribeProvider.Infomaniak && transcribeUrl !== '')
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

    transcribeProvider,
    transcribeEnabled,
    transcribeUrl,
    transcribeKey,
    transcribeConfigured,
    openrouterUrl: pick(options, 'openrouterUrl', 'OPENROUTER_URL', 'https://openrouter.ai/api/v1', String),
    transcribeDataCollection: pick(options, 'transcribeDataCollection', 'TRANSCRIBE_DATA_COLLECTION', 'deny', (v) => (v === 'allow' ? 'allow' : 'deny')),
    transcribeModel: pick(options, 'transcribeModel', 'TRANSCRIBE_MODEL', openrouter ? 'openai/whisper-large-v3-turbo' : 'whisper', String),
    transcribeResultsUrl: pick(options, 'transcribeResultsUrl', 'TRANSCRIBE_RESULTS_URL', '', String),
    transcribePollMs: pick(options, 'transcribePollMs', 'TRANSCRIBE_POLL_MS', 2000),
    transcribeTimeoutMs: pick(options, 'transcribeTimeoutMs', 'TRANSCRIBE_TIMEOUT_MS', openrouter ? 180000 : 600000),
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
  }
}
