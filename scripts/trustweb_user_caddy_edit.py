#!/usr/bin/env python3
"""trustweb.one/<name> reaches the person <name> (wave 8, #one, Jakob 2026-10-15 18:15).

  trustweb_user_caddy_edit.py <in Caddyfile> <out Caddyfile>

Two edits, anchored and idempotent, nothing written unless both blocks transform (or already carry the routes):
  1. the "trustweb.one, www.trustweb.one" block: a single path segment that looks like a username (2..40 of [a-z0-9_-], no dot: a dot means a file or a page, starting with a letter
     or digit) answers 302 to https://app.trustweb.one/who/<name> BEFORE the permanent redirect to trustintheweb.org that the block consists of.
     The root and everything else keep going to trustintheweb.org.
  2. the "app.trustweb.one" block: the same path shape, when it is not an existing file of the app (not file), answers 302 to /who/<name>
     (the wave 6b username route, which answers 302 to /c/<code>). A website subpage of that name on trustintheweb.org is why the explicit
     app.trustweb.one/<name> form exists: it never collides with the site.
Reserved first segments of the app host are excluded by name (service and controller routes), so a username can never shadow them.

Wave 14 (reach-out-link): the name is matched case-insensitively with trailing punctuation or spaces (phone keyboards capitalise and add a dot; the service lowercases),
and a `handle_errors` block (marker "reach-out-link errors") on trustweb.one, www.trustweb.one, app.trustweb.one and trustintheweb.org answers every error with
Content-Type text/html and a page with a retry link, never an empty body (an empty, typeless 404 shows as a 0-byte download on some phones). The name in that page is only
ever a regex capture of [A-Za-z0-9_-], never a raw path placeholder (no markup injection). Blocks edited by an earlier run are upgraded in place.
"""
import re
import sys

TRAIL = r"[.,;:)!?/\s]*"
NAME_RE = r"^/([A-Za-z0-9][A-Za-z0-9_-]{1,39})" + TRAIL + "$"
OLD_NAME_RE = r"^/([a-z0-9][a-z0-9_-]{1,39})$"
RETRY_NAME = r"^/(?:who/)?([A-Za-z0-9][A-Za-z0-9_-]{1,39})" + TRAIL + "$"
ERRORS_MARKER = "reach-out-link errors"
ORG_HEADS = ("trustintheweb.org {\n", "trustintheweb.org, www.trustintheweb.org {\n")
SITE_HEAD = "trustweb.one, www.trustweb.one {\n"
APP_HEAD = "app.trustweb.one {\n"

SITE_ROUTE = (
    "\t# --- a username: trustweb.one/<name> -> the person (wave 8 #one). Root and pages keep the redirect below. ---\n"
    "\t@user path_regexp user " + NAME_RE + "\n"
    "\tredir @user https://app.trustweb.one/who/{re.user.1} 302\n"
)
SITE_ANCHOR = "\tredir https://trustintheweb.org{uri} permanent\n"

OLD_NOT_PATH = "\t\tnot path /backup /hosted /transcribe /feedback /websearch /link /connect /name /org /relay /health /who /c /l /admin /organizer /solo\n"
PREV_NOT_PATH = "\t\tnot path /backup /hosted /transcribe /feedback /websearch /link /connect /name /org /relay /health /who /c /l /admin /organizer /solo /demo /emergent-demo /ea-demo /assets /pwa\n"
# The name pattern accepts a trailing slash, so "/demo/" would match it: each reserved segment is listed with and without the slash.
RESERVED = PREV_NOT_PATH.split("not path ")[1].split()
NOT_PATH = "\t\tnot path " + " ".join(p + s for p in RESERVED for s in ("", "/")) + "\n"
APP_ROUTE = (
    "\t# --- a username: app.trustweb.one/<name> -> /who/<name> (wave 8 #one); never an app file, never a service route ---\n"
    "\t@user {\n"
    "\t\tpath_regexp user " + NAME_RE + "\n"
    + NOT_PATH +
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
        # Already routed. Older lines are upgraded in place: the `not path` line (2026-10-15 16:24: app folders; wave 14: and their trailing-slash forms) and the name pattern (wave 14).
        new = block.replace(OLD_NAME_RE, NAME_RE)
        for old in (OLD_NOT_PATH, PREV_NOT_PATH):
            new = new.replace(old, NOT_PATH) if marker == "\t@user {\n" else new
        print(f"{head.strip()}: " + ("username route upgraded" if new != block else "already has the username route: unchanged"))
        return text[:start] + new + text[end:]
    if block.count(anchor) != 1:
        raise SystemExit(f"{head.strip()}: expected exactly one anchor {anchor.strip()!r}, found {block.count(anchor)}")
    new = block.replace(anchor, route + anchor if before else anchor + route)
    return text[:start] + new + text[end:]


def error_page(link_text: str, link: str, other: str) -> str:
    return f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>TrustWeb</title><p>{link_text} <a href='{link}'>{link}</a></p><p>{other}</p>"


def errors_block(org: bool) -> str:
    """handle_errors: every error answers text/html with a body. The captured name is [A-Za-z0-9_-] only, so it can never carry markup."""
    if org:
        return (
            f"\t# --- {ERRORS_MARKER}: an error never answers an empty body (wave 14) ---\n"
            "\thandle_errors {\n"
            '\t\theader Content-Type "text/html; charset=utf-8"\n'
            '\t\theader Cache-Control "no-store"\n'
            f'\t\trespond "{error_page("Page not found.", "https://trustintheweb.org/", "Home of TrustWeb.")}" {{http.error.status_code}}\n'
            "\t}\n"
        )
    named = error_page("This link did not open. Try again:", "https://app.trustweb.one/who/{re.retry.1}", "Or go to <a href='https://trustintheweb.org'>trustintheweb.org</a>.")
    plain = error_page("This link did not open. Try again:", "https://app.trustweb.one/", "Or go to <a href='https://trustintheweb.org'>trustintheweb.org</a>.")
    return (
        f"\t# --- {ERRORS_MARKER}: an error never answers an empty body (wave 14) ---\n"
        "\thandle_errors {\n"
        '\t\theader Content-Type "text/html; charset=utf-8"\n'
        '\t\theader Cache-Control "no-store"\n'
        f"\t\t@retry path_regexp retry {RETRY_NAME}\n"
        "\t\thandle @retry {\n"
        f'\t\t\trespond "{named}" {{http.error.status_code}}\n'
        "\t\t}\n"
        "\t\thandle {\n"
        f'\t\t\trespond "{plain}" {{http.error.status_code}}\n'
        "\t\t}\n"
        "\t}\n"
    )


def add_errors(text: str, heads: tuple[str, ...], org: bool) -> str:
    present = [h for h in heads if re.search("^" + re.escape(h), text, re.M)]
    if len(present) != 1:
        raise SystemExit(f"expected exactly one of the site blocks {[h.strip() for h in heads]}, found {len(present)}")
    head = present[0]
    start, end = block_span(text, head)
    block = text[start:end]
    if ERRORS_MARKER in block:
        print(f"{head.strip()} already has the error page: unchanged")
        return text
    if "handle_errors" in block:
        raise SystemExit(f"{head.strip()}: has its own handle_errors: refusing to guess")
    return text[:start] + block[: -len("}\n")] + errors_block(org) + "}\n" + text[end:]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(f"usage: {sys.argv[0]} <in Caddyfile> <out Caddyfile>")
    with open(sys.argv[1], "rb") as f:
        text = f.read().decode("utf-8")
    text = add(text, SITE_HEAD, SITE_ANCHOR, SITE_ROUTE, "\t@user path_regexp user ", True)
    text = add(text, APP_HEAD, APP_ANCHOR, APP_ROUTE, "\t@user {\n", True)
    for head in (SITE_HEAD, APP_HEAD):
        text = add_errors(text, (head,), False)
    text = add_errors(text, ORG_HEADS, True)
    with open(sys.argv[2], "wb") as f:
        f.write(text.encode("utf-8"))


if __name__ == "__main__":
    main()
