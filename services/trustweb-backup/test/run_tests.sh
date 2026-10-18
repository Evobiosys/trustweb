#!/bin/sh
# Typecheck backup.ts, compile it to a temp dir (ESM), then run the node:test suites.
# No installs: uses the tsc already present in apps/demo/node_modules (override with TSC=/path/to/tsc, e.g. from the primary checkout).
# transcribe_berget.test.mjs takes no fixed port at all (its server and both fakes listen on port 0).
# websearch.test.mjs, links.test.mjs, connect.test.mjs, aliases.test.mjs and admin.test.mjs (wave 6e) use no fixed port (ephemeral loopback ports for the server and its fake engines).
# Test ports 8971-8978 are fixed, one per file (8972/8973 transcribe + its fake Infomaniak, 8976/8978 transcribe_openrouter (8977 is taken by another program on the dev machine) + its fake OpenRouter; the files run in parallel).
set -eu
echo "trustweb-backup tests running ..."
HERE="$(cd "$(dirname "$0")" && pwd)"
R="$(cd "$HERE/../../.." && pwd)"
TSC="${TSC:-$R/apps/demo/node_modules/.bin/tsc}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cat > "$OUT/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "target": "ES2020", "lib": ["ES2020", "DOM", "DOM.Iterable"], "module": "ESNext",
    "moduleResolution": "bundler", "strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true, "skipLibCheck": true, "isolatedModules": true, "types": [],
    "outDir": "$OUT/js"
  },
  "files": ["$R/apps/trustweb/src/backup.ts"]
}
JSON
echo "--------"
"$TSC" -p "$OUT/tsconfig.json"
echo "typecheck + compile: ok"
echo '{"type":"module"}' > "$OUT/js/package.json"
echo "--------"
BACKUP_JS="$OUT/js/backup.js" node --test "$HERE/backup.test.mjs" "$HERE/server.test.mjs" "$HERE/quota.test.mjs" "$HERE/hosted.test.mjs" "$HERE/transcribe.test.mjs" "$HERE/transcribe_openrouter.test.mjs" "$HERE/transcribe_berget.test.mjs" "$HERE/feedback.test.mjs" "$HERE/compat.test.mjs" "$HERE/limits.test.mjs" "$HERE/websearch.test.mjs" "$HERE/links.test.mjs" "$HERE/connect.test.mjs" "$HERE/aliases.test.mjs" "$HERE/admin.test.mjs" "$HERE/who_hardening.test.mjs" "$HERE/organizer.test.mjs" "$HERE/name_cap.test.mjs" "$HERE/devices.test.mjs"
