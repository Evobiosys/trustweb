#!/usr/bin/env python3
"""Adds the short-link routes (/link and /l/*) to the app.idea2.site and app.trustintheweb.org site blocks of a Caddyfile.

  trustweb_links_caddy_edit.py <in Caddyfile> <out Caddyfile>

Idempotent and anchored: each of the two blocks must contain exactly one /websearch* handle block (the routes go right after it,
next to /hosted /transcribe /feedback /websearch); a block that already has "handle /l/*" is left alone; any other count of
site blocks or anchors aborts with exit 1 and writes nothing. LF endings are kept.
"""
import re
import sys

ROUTE = """\t# --- TrustWeb short connect links (wave 5, services-api-contract "Short links") ---
\t# POST /link stores a long connect url, GET /l/<id> answers 302 to it. The id and the url are capabilities:
\t# log_skip keeps these requests out of Caddy's access log. It does NOT silence the error log, which can still name
\t# the request URI when the upstream fails (accepted risk, see the wave 5 services report).
\thandle /link {
\t\tlog_skip
\t\trequest_body {
\t\t\tmax_size 4KB
\t\t}
\t\treverse_proxy 127.0.0.1:8960
\t}
\thandle /l/* {
\t\tlog_skip
\t\treverse_proxy 127.0.0.1:8960
\t}
"""
ANCHOR = (
    "\thandle /websearch* {\n"
    "\t\t@ws_query expression {http.request.uri.query} != ''\n"
    "\t\trespond @ws_query 400\n"
    "\t\trequest_body {\n"
    "\t\t\tmax_size 4KB\n"
    "\t\t}\n"
    "\t\treverse_proxy 127.0.0.1:8960\n"
    "\t}\n"
)
BLOCKS = ("app.idea2.site {\n", "app.trustintheweb.org {\n")


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
    if "handle /l/*" in block or "handle /link {" in block:
        print(f"{head.strip()} already has the short-link routes: unchanged")
        return text
    if block.count(ANCHOR) != 1:
        raise SystemExit(f"{head.strip()}: expected exactly one /websearch* handle block, found {block.count(ANCHOR)}")
    return text[:start] + block.replace(ANCHOR, ANCHOR + ROUTE) + text[end:]


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, "rb") as f:
        text = f.read().decode("utf-8")
    for head in BLOCKS:
        text = add_routes(text, head)
    with open(dst, "wb") as f:
        f.write(text.encode("utf-8"))


if __name__ == "__main__":
    main()
