#!/usr/bin/env python3
"""trustweb.one/<name> reaches the person <name> (wave 8, #one, Jakob 2026-10-15 18:15).

  trustweb_user_caddy_edit.py <in Caddyfile> <out Caddyfile>

Two edits, anchored and idempotent, nothing written unless both blocks transform (or already carry the routes):
  1. the "trustweb.one, www.trustweb.one" block: a single path segment that looks like a username (2..40 of [a-z0-9._-], starting with a letter
     or digit) answers 302 to https://app.trustweb.one/who/<name> BEFORE the permanent redirect to trustintheweb.org that the block consists of.
     The root and everything else keep going to trustintheweb.org.
  2. the "app.trustweb.one" block: the same path shape, when it is not an existing file of the app (not file), answers 302 to /who/<name>
     (the wave 6b username route, which answers 302 to /c/<code>). A website subpage of that name on trustintheweb.org is why the explicit
     app.trustweb.one/<name> form exists: it never collides with the site.
Reserved first segments of the app host are excluded by name (service and controller routes), so a username can never shadow them.
"""
import re
import sys

NAME_RE = r"^/([a-z0-9][a-z0-9._-]{1,39})$"
SITE_HEAD = "trustweb.one, www.trustweb.one {\n"
APP_HEAD = "app.trustweb.one {\n"

SITE_ROUTE = (
    "\t# --- a username: trustweb.one/<name> -> the person (wave 8 #one). Root and pages keep the redirect below. ---\n"
    "\t@user path_regexp user " + NAME_RE + "\n"
    "\tredir @user https://app.trustweb.one/who/{re.user.1} 302\n"
)
SITE_ANCHOR = "\tredir https://trustintheweb.org{uri} permanent\n"

APP_ROUTE = (
    "\t# --- a username: app.trustweb.one/<name> -> /who/<name> (wave 8 #one); never an app file, never a service route ---\n"
    "\t@user {\n"
    "\t\tpath_regexp user " + NAME_RE + "\n"
    "\t\tnot path /backup /hosted /transcribe /feedback /websearch /link /connect /name /org /relay /health /who /c /l /admin /organizer /solo\n"
    "\t\tnot file\n"
    "\t}\n"
    "\tredir @user /who/{re.user.1} 302\n"
)
APP_ANCHOR = "\thandle /who/* {\n"


def block_span(text: str, head: str) -> tuple[int, int]:
    starts = [m.start() for m in re.finditer("^" + re.escape(head), text, re.M)]
    if len(starts) != 1:
        raise SystemExit(f"expected exactly one site block '{head.strip()}', found {len(starts)}")
    end = text.index("\n}\n", starts[0]) + 3
    return starts[0], end


def add(text: str, head: str, anchor: str, route: str, marker: str, before: bool) -> str:
    start, end = block_span(text, head)
    block = text[start:end]
    if marker in block:
        print(f"{head.strip()} already has the username route: unchanged")
        return text
    if block.count(anchor) != 1:
        raise SystemExit(f"{head.strip()}: expected exactly one anchor {anchor.strip()!r}, found {block.count(anchor)}")
    new = block.replace(anchor, route + anchor if before else anchor + route)
    return text[:start] + new + text[end:]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(f"usage: {sys.argv[0]} <in Caddyfile> <out Caddyfile>")
    with open(sys.argv[1], "rb") as f:
        text = f.read().decode("utf-8")
    text = add(text, SITE_HEAD, SITE_ANCHOR, SITE_ROUTE, "\t@user path_regexp user ", True)
    text = add(text, APP_HEAD, APP_ANCHOR, APP_ROUTE, "\t@user {\n", True)
    with open(sys.argv[2], "wb") as f:
        f.write(text.encode("utf-8"))


if __name__ == "__main__":
    main()
