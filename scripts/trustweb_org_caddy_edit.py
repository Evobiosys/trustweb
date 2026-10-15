#!/usr/bin/env python3
"""Adds the organizer routes (/org and /org/*) to the three app site blocks of a Caddyfile: app.idea2.site, app.trustintheweb.org and
app.trustweb.one (wave 8, services-api-contract section 11).

  trustweb_org_caddy_edit.py <in Caddyfile> <out Caddyfile>

Anchored and idempotent like trustweb_connect_caddy_edit.py (wave 6b): each of the three site blocks must contain exactly one wave-6b
"handle /who/*" block, exactly as wave 6b installed it (the new routes go right after it); a block that already has BOTH new handles is left
alone; a block with one of them, a missing or duplicated anchor, or any other number of site blocks aborts with exit 1 and writes NOTHING.
LF endings are kept. Path matchers, so Caddy runs them before a block's matcher-less page catch-all.

/org is an exact path (the organizer page itself is /organizer.html, a static file of the app: a prefix /org* would swallow it, so no prefix).
Bodies up to 16KB (invitee lists). Organizer codes and secrets travel in POST bodies, never in a URI; the routes are log_skip all the same.
/admin/org is loopback-only inside the service and is NEVER routed here.
"""
import re
import sys

ROUTES = """\t# --- TrustWeb organizer accounts (wave 8, services-api-contract section 11) ---
\t# POST /org creates an organizer account, POST /org/me, /org/event manage its events and invitee list, POST /org/hit counts an
\t# anonymous opened/joined/tagged from attendee phones. The service holds the organizer's own data and three counters, never an attendee.
\thandle /org {
\t\tlog_skip
\t\t@org_query expression {http.request.uri.query} != ''
\t\trespond @org_query 400
\t\trequest_body {
\t\t\tmax_size 16KB
\t\t}
\t\treverse_proxy 127.0.0.1:8960
\t}
\thandle /org/* {
\t\tlog_skip
\t\trequest_body {
\t\t\tmax_size 16KB
\t\t}
\t\treverse_proxy 127.0.0.1:8960
\t}
"""
# The wave-6b /who/* block, byte for byte as scripts/trustweb_connect_caddy_edit.py installed it.
ANCHOR = (
    "\thandle /who/* {\n"
    "\t\tlog_skip\n"
    "\t\treverse_proxy 127.0.0.1:8960\n"
    "\t}\n"
)
MARKERS = ("\thandle /org {\n", "\thandle /org/* {\n")
BLOCKS = ("app.idea2.site {\n", "app.trustintheweb.org {\n", "app.trustweb.one {\n")


def block_span(text: str, head: str) -> tuple[int, int]:
    """[start, end) of a top-level site block: from its head line to the first line that is exactly "}"."""
    starts = [m.start() for m in re.finditer("^" + re.escape(head), text, re.M)]
    if len(starts) != 1:
        raise SystemExit(f"expected exactly one site block '{head.strip()}', found {len(starts)}")
    end = text.index("\n}\n", starts[0]) + 3
    return starts[0], end


def add_routes(text: str, head: str) -> str:
    start, end = block_span(text, head)
    block = text[start:end]
    present = [marker for marker in MARKERS if marker in block]
    if len(present) == len(MARKERS):
        print(f"{head.strip()} already has the organizer routes: unchanged")
        return text
    if present:
        raise SystemExit(f"{head.strip()}: only one of the organizer routes is present: refusing to guess")
    if block.count(ANCHOR) != 1:
        raise SystemExit(f"{head.strip()}: expected exactly one wave-6b /who/* handle block, found {block.count(ANCHOR)}")
    return text[:start] + block.replace(ANCHOR, ANCHOR + ROUTES) + text[end:]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(f"usage: {sys.argv[0]} <in Caddyfile> <out Caddyfile>")
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, "rb") as f:
        text = f.read().decode("utf-8")
    for head in BLOCKS:
        text = add_routes(text, head)
    with open(dst, "wb") as f:
        f.write(text.encode("utf-8"))


if __name__ == "__main__":
    main()
