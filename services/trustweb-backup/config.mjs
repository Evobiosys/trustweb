// Configuration of the hosted, transcribe and feedback features: options (tests) win over env, env over defaults.
// The old backup settings stay in server.mjs, unchanged.
//
// ENV (all optional; a feature whose settings are missing answers 503 not_configured)
//   HOSTED_DIR                       directory for hosted recordings (own dir, never BACKUP_DIR). Unset = hosting off.
//   HOSTED_MAX_BYTES                 2000000000   total hosted ciphertext on this server
//   HOSTED_MIN_FREE_BYTES            2000000000   refuse new hosted writes when the filesystem has less free (backups must never starve)
//   HOSTED_RETENTION_DAYS            90           the sweeper removes recordings untouched this long
//   ACCOUNT_SECONDS_LIMIT            36000        free plan: total declared seconds per account (10 x 1 h)
//   ACCOUNT_BYTES_LIMIT              200000000    free plan: total ciphertext bytes per account (4000 B/s x 36000 s = 144 MB, plus headroom)
//   MAX_REC_BYTES                    30000000     one recording (1 h at ~67 kbps)
//   MAX_RECORDINGS                   50           slots per account (anti-spam only)
//   HOSTED_WRITES_PER_HOUR_PER_IP    60
//   ACCOUNT_CREATES_PER_IP_DAY       5            new accounts (first writes) per IP and UTC day
//   REC_GETS_PER_HOUR                30           downloads per recording per hour
//   MAX_CONCURRENT_UPLOADS           6
//   UPLOAD_IDLE_MS                   30000        abort an upload that sends nothing for this long
//   LONG_REQUEST_MS                  900000       request deadline of /hosted and /transcribe (the short routes keep SHORT_REQUEST_MS)
//   SHORT_REQUEST_MS                 30000
//   TRANSCRIBE_URL, TRANSCRIBE_KEY   provider endpoint (full POST URL incl. product id) and bearer token (EnvironmentFile 0600)
//   TRANSCRIBE_MODEL                 whisper
//   TRANSCRIBE_RESULTS_URL           optional template with {batch_id}; derived from TRANSCRIBE_URL otherwise
//   TRANSCRIBE_POLL_MS               2000
//   TRANSCRIBE_TIMEOUT_MS            600000       submit + polling, in total
//   TRANSCRIBE_DAILY_SECONDS         7200         everyone together, per UTC day
//   TRANSCRIBE_IP_DAILY_SECONDS      3600         per IP and UTC day
//   TRANSCRIBE_MAX_CONCURRENT        2
//   TRANSCRIBE_MAX_BYTES             21600000     1 h at 48 kbps
//   FEEDBACK_FILE                    path of the 0600 JSON-lines file. Unset = feedback off.
//   FEEDBACK_ORIGINS                 comma list, default https://idea2.site,https://app.idea2.site
//   FEEDBACK_MAX_BYTES               2000000
//   FEEDBACK_PER_HOUR                5            per IP

function pick(options, key, envName, fallback, parse = Number) {
  if (options[key] !== undefined) return options[key]
  const raw = process.env[envName]
  return raw === undefined || raw === '' ? fallback : parse(raw)
}

const list = (raw) => raw.split(',').map((s) => s.trim()).filter(Boolean)

export function loadConfig(options = {}) {
  const transcribeUrl = pick(options, 'transcribeUrl', 'TRANSCRIBE_URL', '', String)
  const transcribeKey = pick(options, 'transcribeKey', 'TRANSCRIBE_KEY', '', String)
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
    accountBytesLimit: pick(options, 'accountBytesLimit', 'ACCOUNT_BYTES_LIMIT', 200_000_000),
    maxRecSeconds: 3600,
    maxRecBytes: pick(options, 'maxRecBytes', 'MAX_REC_BYTES', 30_000_000),
    maxRecordings: pick(options, 'maxRecordings', 'MAX_RECORDINGS', 50),
    sanityBytesPerSecond: 16000,
    hostedWritesPerHourPerIp: pick(options, 'hostedWritesPerHourPerIp', 'HOSTED_WRITES_PER_HOUR_PER_IP', 60),
    accountCreatesPerIpDay: pick(options, 'accountCreatesPerIpDay', 'ACCOUNT_CREATES_PER_IP_DAY', 5),
    recGetsPerHour: pick(options, 'recGetsPerHour', 'REC_GETS_PER_HOUR', 30),
    maxConcurrentUploads: pick(options, 'maxConcurrentUploads', 'MAX_CONCURRENT_UPLOADS', 6),
    uploadIdleMs: pick(options, 'uploadIdleMs', 'UPLOAD_IDLE_MS', 30000),

    transcribeUrl,
    transcribeKey,
    transcribeConfigured: transcribeUrl !== '' && transcribeKey !== '',
    transcribeModel: pick(options, 'transcribeModel', 'TRANSCRIBE_MODEL', 'whisper', String),
    transcribeResultsUrl: pick(options, 'transcribeResultsUrl', 'TRANSCRIBE_RESULTS_URL', '', String),
    transcribePollMs: pick(options, 'transcribePollMs', 'TRANSCRIBE_POLL_MS', 2000),
    transcribeTimeoutMs: pick(options, 'transcribeTimeoutMs', 'TRANSCRIBE_TIMEOUT_MS', 600000),
    transcribeDailySeconds: pick(options, 'transcribeDailySeconds', 'TRANSCRIBE_DAILY_SECONDS', 7200),
    transcribeIpDailySeconds: pick(options, 'transcribeIpDailySeconds', 'TRANSCRIBE_IP_DAILY_SECONDS', 3600),
    transcribeMaxConcurrent: pick(options, 'transcribeMaxConcurrent', 'TRANSCRIBE_MAX_CONCURRENT', 2),
    transcribeMaxBytes: pick(options, 'transcribeMaxBytes', 'TRANSCRIBE_MAX_BYTES', 21_600_000),

    feedbackFile,
    feedbackConfigured: feedbackFile !== '',
    feedbackOrigins: options.feedbackOrigins ?? list(process.env.FEEDBACK_ORIGINS ?? 'https://idea2.site,https://app.idea2.site'),
    feedbackMaxBytes: pick(options, 'feedbackMaxBytes', 'FEEDBACK_MAX_BYTES', 2_000_000),
    feedbackPerHour: pick(options, 'feedbackPerHour', 'FEEDBACK_PER_HOUR', 5),
  }
}
