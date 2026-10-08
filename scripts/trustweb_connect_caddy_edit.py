#!/usr/bin/env python3
"""Adds the connect-code routes (/connect, /c/*, /name, /who/*) to the three app site blocks of a Caddyfile: app.idea2.site,
app.trustintheweb.org and app.trustweb.one (wave 6c; its block is a generated copy of the .org one, so it has the same wave-5 anchor).

  trustweb_connect_caddy_edit.py <in Caddyfile> <out Caddyfile>

Wave 6b (services-api-contract section 10). Anchored and idempotent: each of the three site blocks must contain exactly one wave-5 "handle /l/*"
block, exactly as wave 5 installed it (the new routes go right after it); a block that already has ALL FOUR new handles is left alone; a block
with some but not all of them, a missing or duplicated anchor, or any other number of site blocks aborts with exit 1 and writes NOTHING (the
output file is created only after all three blocks were transformed). LF endings are kept. The new handles have path matchers, so Caddy
runs them before a block's matcher-less page catch-all, including the wave 6c redirect catch-all of app.trustintheweb.org.

POST routes (/connect, /name) get the query-string guard of wave 5 (a query on them is a 400) and request_body max_size 4KB. /c/* and /who/*
accept a query string on purpose: messengers append tracking parameters to a tapped link. All four routes are log_skip.
"""
import re
import sys

ROUTES = """\t# --- TrustWeb connect codes and usernames (wave 6b, services-api-contract section 10) ---
\t# POST /connect stores a person's long connect url under a stable code, GET /c/<code> answers 302 to it; POST /name claims a username
\t# for the code, GET /who/<name> answers 302 to /c/<code>. Codes, secrets, names and urls are capabilities: log_skip keeps these requests
\t# out of Caddy's access log. It does NOT silence the error log, which can still name the request URI of /c/* and /who/* when the upstream
\t# fails (accepted risk, as for /l/*); a secret and a url travel in POST bodies, never in a URI.
\thandle /connect {
\t\tlog_skip
\t\t@connect_query expression {http.request.uri.query} != ''
\t\trespond @connect_query 400
\t\trequest_body {
\t\t\tmax_size 4KB
\t\t}
\t\treverse_proxy 127.0.0.1:8960
\t}
\thandle /c/* {
\t\tlog_skip
\t\treverse_proxy 127.0.0.1:8960
\t}
\thandle /name {
\t\tlog_skip
\t\t@name_query expression {http.request.uri.query} != ''
\t\trespond @name_query 400
\t\trequest_body {
\t\t\tmax_size 4KB
\t\t}
\t\treverse_proxy 127.0.0.1:8960
\t}
\thandle /who/* {
\t\tlog_skip
\t\treverse_proxy 127.0.0.1:8960
\t}
"""
# The wave-5 /l/* block, byte for byte as scripts/trustweb_links_caddy_edit.py installed it.
ANCHOR = (
    "\thandle /l/* {\n"
    "\t\tlog_skip\n"
    "\t\treverse_proxy 127.0.0.1:8960\n"
    "\t}\n"
)
MARKERS = ("\thandle /connect {\n", "\thandle /c/* {\n", "\thandle /name {\n", "\thandle /who/* {\n")
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
        print(f"{head.strip()} already has the connect routes: unchanged")
        return text
    if present:
        raise SystemExit(f"{head.strip()}: only some of the connect routes are present ({len(present)} of {len(MARKERS)}): refusing to guess")
    if block.count(ANCHOR) != 1:
        raise SystemExit(f"{head.strip()}: expected exactly one wave-5 /l/* handle block, found {block.count(ANCHOR)}")
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
