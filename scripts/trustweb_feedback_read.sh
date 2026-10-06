#!/bin/bash
# Print the website feedback of TrustWeb, newest last, read-only, over ssh.
#
#   ./scripts/trustweb_feedback_read.sh            production file
#   ./scripts/trustweb_feedback_read.sh --staging  staging file
#   ./scripts/trustweb_feedback_read.sh --file <path>   a local copy (no ssh; used by the tests)
#
# The server appends one JSON line per entry to a 0600 file in the hosted data dir (feedback.jsonl);
# this script only `cat`s it through ssh (the control master of the questhub recipe) and formats it here.
# Everything in that file was typed by strangers: control characters (ANSI escapes, carriage returns, C1 codes)
# and invisible format characters (bidi overrides, zero-width) are shown as \u{XXXX}, never sent to the terminal.
set -euo pipefail
echo "… trustweb_feedback_read running …"
echo "--------"
DIR="trustweb-hosted"
SOURCE="/var/lib/$DIR/feedback.jsonl"
case "${1:-}" in
  "") ;;
  --staging) DIR="trustweb-hosted-staging"; SOURCE="/var/lib/$DIR/feedback.jsonl" ;;
  --file) SOURCE="${2:?--file needs a path}" ;;
  *) echo "usage: $0 [--staging | --file <path>]" >&2; exit 2 ;;
esac
if [ "${1:-}" = "--file" ]; then
  RAW="$(cat -- "$SOURCE" 2>/dev/null || true)"
else
  SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
  ssh-add --apple-load-keychain >/dev/null 2>&1 || true
  RAW="$("${SSHENV[@]}" ssh questhub "sudo cat /var/lib/$DIR/feedback.jsonl 2>/dev/null || true")"
fi
if [ -z "$RAW" ]; then
  echo "no feedback yet ($SOURCE is empty or missing)"
  echo "--------"
  exit 0
fi
PYCODE=$(cat <<'PY'
import json, sys, unicodedata

def visible(value, keep_newlines=False):
    # Stored text is untrusted: every control (Cc) or format (Cf) character becomes a visible escape.
    text = value if isinstance(value, str) else json.dumps(value)
    out = []
    for ch in text:
        if keep_newlines and ch == "\n":
            out.append(ch)
        elif unicodedata.category(ch) in ("Cc", "Cf", "Zl", "Zp"):
            out.append("\\u{%04x}" % ord(ch))
        else:
            out.append(ch)
    return "".join(out)

sys.stdin.reconfigure(encoding="utf-8", errors="replace")
n = 0
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    n += 1
    try:
        e = json.loads(line)
    except ValueError:
        print("(unreadable line)")
        print("--------")
        continue
    if not isinstance(e, dict):
        print("(unreadable line)")
        print("--------")
        continue
    head = "{}  [{}]  page: {}  contact: {}".format(*(visible(e.get(k) or d) for k, d in (("t", "?"), ("kind", "feedback"), ("page", "-"), ("contact", "-"))))
    print(head)
    print(visible(e.get("text", ""), keep_newlines=True))
    print("--------")
print("{} entries".format(n))
PY
)
printf '%s\n' "$RAW" | python3 -I -c "$PYCODE"
