#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
"""Adds POST /names/cap-request (wave 21 name-cap-request) to the three app site blocks of a Caddyfile: app.idea2.site,
app.trustintheweb.org and app.trustweb.one.

  trustweb_namecap_caddy_edit.py <in Caddyfile> <out Caddyfile>

The new handle is a copy of the connect edit's `handle /name {` block (query-string guard 400, request_body max_size 4KB, log_skip, same
upstream) and goes right after it. Anchored and idempotent: a block that already has the route is left alone; a block without exactly one
`handle /name {` block, or any other number of site blocks, aborts with exit 1 and writes NOTHING.
"""
import re
import sys

NAME_BLOCK = (
    "\thandle /name {\n"
    "\t\tlog_skip\n"
    "\t\t@name_query expression {http.request.uri.query} != ''\n"
    "\t\trespond @name_query 400\n"
    "\t\trequest_body {\n"
    "\t\t\tmax_size 4KB\n"
    "\t\t}\n"
    "\t\treverse_proxy 127.0.0.1:8960\n"
    "\t}\n"
)
MARKER = "\thandle /names/cap-request {\n"
ROUTE = (
    "\t# --- TrustWeb name capability requests (wave 21 name-cap-request) ---\n"
    "\t# POST /names/cap-request {code, secret, name, reason, wanted}: capability material travels in the body only, so log_skip and a 400 on any query.\n"
    + MARKER
    + NAME_BLOCK.split("\n", 1)[1].replace("@name_query", "@namecap_query")
)
BLOCKS = ("app.idea2.site {\n", "app.trustintheweb.org {\n", "app.trustweb.one {\n")


def block_span(text: str, head: str) -> tuple[int, int]:
    """[start, end) of a top-level site block: from its head line to the first line that is exactly "}"."""
    starts = [m.start() for m in re.finditer("^" + re.escape(head), text, re.M)]
    if len(starts) != 1:
        raise SystemExit(f"expected exactly one site block '{head.strip()}', found {len(starts)}")
    return starts[0], text.index("\n}\n", starts[0]) + 3


def add_route(text: str, head: str) -> str:
    start, end = block_span(text, head)
    block = text[start:end]
    if MARKER in block:
        print(f"{head.strip()} already has /names/cap-request: unchanged")
        return text
    if block.count(NAME_BLOCK) != 1:
        raise SystemExit(f"{head.strip()}: expected exactly one 'handle /name {{' block, found {block.count(NAME_BLOCK)}")
    return text[:start] + block.replace(NAME_BLOCK, NAME_BLOCK + ROUTE) + text[end:]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(f"usage: {sys.argv[0]} <in Caddyfile> <out Caddyfile>")
    with open(sys.argv[1], "rb") as f:
        text = f.read().decode("utf-8")
    for head in BLOCKS:
        text = add_route(text, head)
    with open(sys.argv[2], "wb") as f:
        f.write(text.encode("utf-8"))


if __name__ == "__main__":
    main()
