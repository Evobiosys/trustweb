#!/bin/bash
# Print the website feedback of TrustWeb, newest last, read-only, over ssh.
#
#   ./scripts/trustweb_feedback_read.sh            production file
#   ./scripts/trustweb_feedback_read.sh --staging  staging file
#
# The server appends one JSON line per entry to a 0600 file in the hosted data dir (feedback.jsonl);
# this script only `cat`s it through ssh (the control master of the questhub recipe) and formats it here.
set -euo pipefail
echo "… trustweb_feedback_read running …"
echo "--------"
DIR="trustweb-hosted"
[ "${1:-}" = "--staging" ] && DIR="trustweb-hosted-staging"
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)
ssh-add --apple-load-keychain >/dev/null 2>&1 || true
RAW="$("${SSHENV[@]}" ssh questhub "sudo cat /var/lib/$DIR/feedback.jsonl 2>/dev/null || true")"
if [ -z "$RAW" ]; then
  echo "no feedback yet (/var/lib/$DIR/feedback.jsonl is empty or missing)"
  echo "--------"
  exit 0
fi
PYCODE=$(cat <<'PY'
import json, sys
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
    head = "{}  [{}]  page: {}  contact: {}".format(e.get("t", "?"), e.get("kind", "feedback"), e.get("page") or "-", e.get("contact") or "-")
    print(head)
    print(e.get("text", ""))
    print("--------")
print("{} entries".format(n))
PY
)
printf '%s\n' "$RAW" | python3 -I -c "$PYCODE"
