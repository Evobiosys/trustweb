"""Caddyfile transforms for the TrustInTheWeb domains (wave 3, 2026-10-07).

Reads a Caddyfile on stdin-free paths (--in / --out), applies one or more
named transforms, and writes the result. Every transform is idempotent (a
marker comment says it already ran) and exact-text: when an anchor it needs
is missing, it exits non-zero and writes nothing, so a drifted live file is
never half-edited. scripts/trustweb_domains.sh fetches the live file, runs
this, validates the result with `caddy validate` on questhub, and only then
installs it.

  python3 -I scripts/trustweb_domains_caddy.py --in live --out new sites
  python3 -I scripts/trustweb_domains_caddy.py --in live --out new idea2-redirect evobiosys-redirect

Transforms
  sites               appends the site blocks: trustintheweb.org, app.trustintheweb.org,
                      trustintheweb.com (each with www -> apex), trustweb.one -> trustintheweb.org
  idea2-redirect      idea2.site/trustweb/* and /tw, /trust-web -> 301 https://trustintheweb.org{path};
                      /trustweb/draft/ keeps serving the draft folder
  evobiosys-redirect  evobiosys.org /tw, /trustweb (and subpaths) -> 301 https://evobiosys.org/trustintheweb/
  app-trustweb-one    (wave 6c) the site block app.trustweb.one = the LIVE app.trustintheweb.org block copied, with
                      only its host, its root directory and the deploy-target comment changed, so every route that
                      block has today (and every one a later wave adds to it) is there by construction. Run again
                      after a later wave added routes to the .org block: it replaces the generated block in place.
  demo-trustweb-one   (wave 6c) demo.trustweb.one -> 301 https://app.trustweb.one/demo{uri}
  app-org-redirect    (wave 6c, Jakob 2026-10-08 12:53) app.trustintheweb.org: ONLY its final page catch-all (the file_server)
                      becomes 301 https://app.trustweb.one{uri}. Every handle above it (/relay, /backup, /hosted, /transcribe,
                      /feedback, /websearch, /link, /l and whatever a later wave adds) keeps serving, so old DID documents that
                      name https://app.trustintheweb.org/relay still work. Nothing is deleted: the app folder stays where it is.
                      Refused unless the app.trustweb.one block exists. app-trustweb-one turns a redirect catch-all in the .org
                      block back into the file_server for the .one block, so a rerun never copies the redirect onto the new host.

  python3 -I -B scripts/trustweb_domains_caddy.py --in live --parity   exits 1 and prints the diff when the two app
                      blocks differ in anything but host, marker and the page catch-all (the evidence for "modelled exactly").
"""
from __future__ import annotations

import argparse
import difflib
import sys
from collections.abc import Callable
from enum import Enum

QUESTHUB_STATIC = "/srv/questhub-static"
SITE_ORG_DIR = f"{QUESTHUB_STATIC}/trustintheweb-org"
SITE_COM_DIR = f"{QUESTHUB_STATIC}/trustintheweb-com"
APP_DIR = f"{QUESTHUB_STATIC}/app-trustintheweb"
APP_ONE_DIR = f"{QUESTHUB_STATIC}/app-trustweb-one"
BACKUP_UPSTREAM = "127.0.0.1:8960"
RELAY_UPSTREAM = "127.0.0.1:4177"

SITES_MARKER = "# --- TrustInTheWeb domains (wave 3, scripts/trustweb_domains.sh) ---"
IDEA2_MARKER = "# TrustInTheWeb migration (wave 3, 2026-10-07):"
EVOBIOSYS_MARKER = "# TrustInTheWeb (wave 3, 2026-10-07):"
APP_ONE_HEAD = "app.trustweb.one {"
APP_ORG_HEAD = "app.trustintheweb.org {"
DEMO_ONE_HEAD = "demo.trustweb.one {"
APP_ONE_MARKER = "# app.trustweb.one (wave 6c): generated from the app.trustintheweb.org block by scripts/trustweb_domains_caddy.py app-trustweb-one."
DEMO_ONE_MARKER = "# --- demo.trustweb.one (wave 6c, scripts/trustweb_domains.sh) ---"
DEPLOY_TARGET_ORG = "TW_APP_TARGET=trustintheweb"
DEPLOY_TARGET_ONE = "TW_APP_TARGET=trustweb-one"
ORG_REDIRECT_MARKER = "# app.trustintheweb.org (wave 6c, Jakob 2026-10-08 12:53): page loads go to the canonical app host."


class TransformError(Exception):
    """An anchor the transform needs is not in the file: nothing is written."""


class Transform(str, Enum):
    SITES = "sites"
    IDEA2_REDIRECT = "idea2-redirect"
    EVOBIOSYS_REDIRECT = "evobiosys-redirect"
    APP_TRUSTWEB_ONE = "app-trustweb-one"
    DEMO_TRUSTWEB_ONE = "demo-trustweb-one"
    APP_ORG_REDIRECT = "app-org-redirect"


# Static sites get the header set of the hardened sites on this server (transparent.news, 2026-10-06):
# HSTS without preload/includeSubDomains (reversible), nosniff, referrer policy, no powerful features.
# The app gets the same, except that it records meetings (microphone) and may scan QR codes (camera)
# on its own origin: camera=() / microphone=() there would silently break recording.
SITES_BLOCK = f"""
{SITES_MARKER}
# trustintheweb.org = the website (migrated from idea2.site/trustweb), app.trustintheweb.org = the
# web app at its root (same backup / hosted / transcribe / feedback / relay upstreams as
# app.idea2.site, which stays unchanged: storage is per origin, so existing phones keep their data
# there), trustintheweb.com = the hosting site, trustweb.one = a redirect to trustintheweb.org.
# DNS: A records -> this box (Infomaniak zones, TTL 300). No AAAA yet (see the wave 3 report).
(tw_site_headers) {{
	header {{
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
	}}
}}

(tw_static_site) {{
	import tw_site_headers
	encode gzip
	# HTML is revalidated on every load (the site changes often; no hashed assets).
	header Cache-Control "no-cache"
	file_server
}}

trustintheweb.org {{
	root * {SITE_ORG_DIR}
	import tw_static_site
}}

www.trustintheweb.org {{
	redir https://trustintheweb.org{{uri}} permanent
}}

trustintheweb.com {{
	root * {SITE_COM_DIR}
	import tw_static_site
}}

www.trustintheweb.com {{
	redir https://trustintheweb.com{{uri}} permanent
}}

trustweb.one, www.trustweb.one {{
	redir https://trustintheweb.org{{uri}} permanent
}}

app.trustintheweb.org {{
	header {{
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(self), microphone=(self), geolocation=()"
	}}
	# Same upstreams and limits as app.idea2.site (copied blocks). The paths under /backup/ and
	# /hosted/ carry secrets (blob id, account id): keep them out of any access log.
	handle /backup/* {{
		request_body {{
			max_size 1100KB
		}}
		reverse_proxy {BACKUP_UPSTREAM}
	}}
	handle /hosted/* {{
		request_body {{
			max_size 31MB
		}}
		reverse_proxy {BACKUP_UPSTREAM} {{
			transport http {{
				read_timeout 15m
				write_timeout 15m
				response_header_timeout 15m
			}}
		}}
	}}
	handle /transcribe {{
		request_body {{
			max_size 22MB
		}}
		reverse_proxy {BACKUP_UPSTREAM} {{
			transport http {{
				read_timeout 15m
				write_timeout 15m
				response_header_timeout 15m
			}}
		}}
	}}
	handle /feedback {{
		request_body {{
			max_size 20KB
		}}
		reverse_proxy {BACKUP_UPSTREAM}
	}}
	# The one relay process: a phone on app.idea2.site and one on app.trustintheweb.org reach each
	# other (the relay routes on the recipient DID only, and each app posts to its own origin).
	handle /relay/* {{
		reverse_proxy {RELAY_UPSTREAM}
	}}
	# The app, built with base "/" (scripts/deploy_wot.sh, TW_APP_TARGET=trustintheweb).
	handle {{
		root * {APP_DIR}
		@tw_app_assets path /assets/*
		header @tw_app_assets Cache-Control "public, max-age=31536000, immutable"
		@tw_app_html not path /assets/*
		header @tw_app_html Cache-Control "no-cache"
		file_server
	}}
}}
"""

# idea2.site: the exact lines this transform replaces (as live on 2026-10-07).
IDEA2_OLD_SERVE = """	@trustweb_bare path /trustweb
	redir @trustweb_bare /trustweb/ 308
	handle_path /trustweb/* {
		root * /srv/questhub-static/idea2-tw
		file_server
	}
"""
# The first version (installed 2026-10-07 12:10) had two sibling handle_path blocks, /trustweb/draft/* and
# /trustweb/*; Caddy did not prefer the longer one, so the draft answered 301 too. Kept verbatim so the
# transform upgrades a file that carries it. The current version nests the draft inside the one block.
IDEA2_DRAFT_V1 = """	handle_path /trustweb/draft/* {
		root * /srv/questhub-static/idea2-tw/draft
		file_server
	}
	handle_path /trustweb/* {
		redir https://trustintheweb.org{uri} permanent
	}
"""
IDEA2_DRAFT_V2 = """	handle_path /trustweb/* {
		@trustweb_draft path /draft/*
		handle @trustweb_draft {
			root * /srv/questhub-static/idea2-tw
			file_server
		}
		handle {
			redir https://trustintheweb.org{uri} permanent
		}
	}
"""
IDEA2_NEW_SERVE = f"""	{IDEA2_MARKER} the site moved to https://trustintheweb.org.
	# /trustweb and every page under it answer 301 to the same page there (the deployed app links
	# to idea2.site/trustweb/faq.html etc.: those keep working). /trustweb/draft/ still serves the
	# draft folder (scripts/build_tw_front_door.sh --draft). Rollback: Caddyfile.bak.<ts> of that day.
	@trustweb_bare path /trustweb
	redir @trustweb_bare https://trustintheweb.org/ permanent
	@trustweb_draft_bare path /trustweb/draft
	redir @trustweb_draft_bare /trustweb/draft/ 308
""" + IDEA2_DRAFT_V2
IDEA2_OLD_ALIAS = """	handle @trustweb_alias {
		redir https://idea2.site/trustweb/ temporary
	}
"""
IDEA2_NEW_ALIAS = """	handle @trustweb_alias {
		redir https://trustintheweb.org/ permanent
	}
"""

# evobiosys.org: inserted inside its route { } right before this anchor, so it runs first in order.
EVOBIOSYS_ANCHOR = """		# /pitch has no index page on live (its /pitch/ target itself 404s) so it
"""
EVOBIOSYS_INSERT = f"""		{EVOBIOSYS_MARKER} /tw and /trustweb (and anything under them) go to
		# the page on how TrustWeb fits with EvoBioSys. Exact prefixes, so no other page is swallowed.
		@trustintheweb_alias path /tw /tw/ /tw/* /trustweb /trustweb/ /trustweb/*
		redir @trustintheweb_alias https://evobiosys.org/trustintheweb/ permanent

"""


def _site_block_span(text: str, header: str) -> tuple[int, int]:
    """Start and end offsets of the top-level block whose first line is exactly `header`."""
    start = text.find("\n" + header + "\n")
    if start < 0:
        raise TransformError(f"site block not found: {header!r}")
    start += 1
    end = text.find("\n}\n", start)
    if end < 0:
        raise TransformError(f"site block not closed: {header!r}")
    return start, end + 3


def _replace_once_in_block(text: str, header: str, old: str, new: str) -> str:
    start, end = _site_block_span(text, header)
    block = text[start:end]
    if block.count(old) != 1:
        raise TransformError(f"expected exactly one anchor in {header!r}, found {block.count(old)}: {old.splitlines()[0]!r}")
    return text[:start] + block.replace(old, new) + text[end:]


def add_sites(text: str) -> str:
    if SITES_MARKER in text:
        return text
    for host in ("trustintheweb.org", "app.trustintheweb.org", "trustintheweb.com", "trustweb.one"):
        if f"\n{host} {{" in text or f"\n{host}, " in text:
            raise TransformError(f"a site block for {host} exists without the marker: edit by hand")
    return text.rstrip("\n") + "\n" + SITES_BLOCK


def idea2_redirect(text: str) -> str:
    if IDEA2_MARKER in text:
        if IDEA2_DRAFT_V1 in text:
            return _replace_once_in_block(text, "idea2.site, www.idea2.site {", IDEA2_DRAFT_V1, IDEA2_DRAFT_V2)
        return text
    header = "idea2.site, www.idea2.site {"
    text = _replace_once_in_block(text, header, IDEA2_OLD_SERVE, IDEA2_NEW_SERVE)
    return _replace_once_in_block(text, header, IDEA2_OLD_ALIAS, IDEA2_NEW_ALIAS)


def evobiosys_redirect(text: str) -> str:
    if EVOBIOSYS_MARKER in text:
        return text
    return _replace_once_in_block(text, "evobiosys.org, www.evobiosys.org {", EVOBIOSYS_ANCHOR, EVOBIOSYS_INSERT + EVOBIOSYS_ANCHOR)


# A direct visit to demo.trustweb.one/demo... must not become /demo/demo...; everything else gets /demo prefixed
# ("/" becomes "/demo/", which is the demo's own page). Both are permanent, like the other redirect blocks here.
DEMO_ONE_BLOCK = f"""
{DEMO_ONE_MARKER}
# Jakob 2026-10-08: demo.trustweb.one goes to the demo, which lives in the app at /demo/.
{DEMO_ONE_HEAD}
	@demo_already path /demo /demo/*
	redir @demo_already https://app.trustweb.one{{uri}} permanent
	redir https://app.trustweb.one/demo{{uri}} permanent
}}
"""


def _serve_catchall(app_dir: str, deploy_target: str) -> str:
    """The page catch-all of an app block: the built app from `app_dir`, assets immutable, HTML revalidated."""
    return (
        f"\t# The app, built with base \"/\" (scripts/deploy_wot.sh, {deploy_target}).\n"
        "\thandle {\n"
        f"\t\troot * {app_dir}\n"
        "\t\t@tw_app_assets path /assets/*\n"
        "\t\theader @tw_app_assets Cache-Control \"public, max-age=31536000, immutable\"\n"
        "\t\t@tw_app_html not path /assets/*\n"
        "\t\theader @tw_app_html Cache-Control \"no-cache\"\n"
        "\t\tfile_server\n"
        "\t}\n"
    )


ORG_SERVE_CATCHALL = _serve_catchall(APP_DIR, DEPLOY_TARGET_ORG)
ONE_SERVE_CATCHALL = _serve_catchall(APP_ONE_DIR, DEPLOY_TARGET_ONE)
# FROZEN once installed: app-trustweb-one, app-org-redirect and --parity recognise the live redirect by this exact text,
# so an edit after the deploy makes them refuse (or report drift) until the live block is edited to match by hand.
# Cache-Control no-store (review 6c): a 301 without it is cached by browsers indefinitely, and lifting the redirect
# (restoring the Caddyfile backup) is the only way back to the data an app.trustintheweb.org phone keeps in its browser.
ORG_REDIRECT_CATCHALL = (
    f"\t{ORG_REDIRECT_MARKER} The URI (path, query) is kept, so an old QR\n"
    "\t# or connect link lands on the new host. The handles above keep serving (old DID documents name this host's /relay).\n"
    f"\t# Nothing is deleted: {APP_DIR} stays on disk. Lift the redirect: restore the Caddyfile.bak.<ts> that\n"
    "\t# scripts/trustweb_domains.sh org-redirect wrote. no-store: browsers must not store this 301, so lifting it brings the pages back.\n"
    "\thandle {\n"
    "\t\theader Cache-Control \"no-store\"\n"
    "\t\tredir https://app.trustweb.one{uri} permanent\n"
    "\t}\n"
)


def _clone_app_block(org_block: str) -> str:
    """The app.trustintheweb.org block as the app.trustweb.one block: host, marker and (for a redirecting .org block) the page catch-all.

    The page catch-all of the .one block is always the file_server, whether the .org block currently serves the
    app or (after app-org-redirect) redirects to this very host.
    """
    if not org_block.startswith(APP_ORG_HEAD + "\n"):
        raise TransformError(f"the {APP_ORG_HEAD!r} block does not start with its head line")
    serving, redirecting = org_block.count(ORG_SERVE_CATCHALL), org_block.count(ORG_REDIRECT_CATCHALL)
    if serving + redirecting != 1:
        raise TransformError(f"expected exactly one page catch-all (serving or redirecting) in the {APP_ORG_HEAD!r} block, found {serving} + {redirecting}")
    body = org_block[len(APP_ORG_HEAD) + 1:]
    body = body.replace(ORG_SERVE_CATCHALL, ONE_SERVE_CATCHALL).replace(ORG_REDIRECT_CATCHALL, ONE_SERVE_CATCHALL)
    return f"{APP_ONE_HEAD}\n\t{APP_ONE_MARKER}\n{body}"


def add_app_trustweb_one(text: str) -> str:
    if SITES_MARKER not in text:
        raise TransformError("the wave 3 site blocks are not in this Caddyfile (marker missing): run sites first")
    org_start, org_end = _site_block_span(text, APP_ORG_HEAD)
    new_block = _clone_app_block(text[org_start:org_end])
    if f"\n{APP_ONE_HEAD}\n" not in text:
        for other in ("app.trustweb.one,", ", app.trustweb.one"):
            if other in text:
                raise TransformError("app.trustweb.one is already a site address in a list: edit by hand")
        return text.rstrip("\n") + "\n\n" + new_block
    start, end = _site_block_span(text, APP_ONE_HEAD)
    if APP_ONE_MARKER not in text[start:end]:
        raise TransformError("an app.trustweb.one block exists without the marker: edit by hand")
    return text[:start] + new_block + text[end:]


def add_demo_trustweb_one(text: str) -> str:
    if DEMO_ONE_MARKER in text:
        return text
    if "demo.trustweb.one" in text:
        raise TransformError("demo.trustweb.one is already in this Caddyfile without the marker: edit by hand")
    return text.rstrip("\n") + "\n" + DEMO_ONE_BLOCK


def app_block_parity(text: str) -> list[str]:
    """Unified diff of the two app blocks once host, marker and the page catch-all are normalised; empty = identical."""
    org_start, org_end = _site_block_span(text, APP_ORG_HEAD)
    one_start, one_end = _site_block_span(text, APP_ONE_HEAD)
    org = text[org_start:org_end].replace(ORG_REDIRECT_CATCHALL, ORG_SERVE_CATCHALL)
    one = text[one_start:one_end].replace(f"\t{APP_ONE_MARKER}\n", "", 1).replace(APP_ONE_HEAD, APP_ORG_HEAD, 1)
    one = one.replace(ONE_SERVE_CATCHALL, ORG_SERVE_CATCHALL)
    return list(difflib.unified_diff(org.splitlines(), one.splitlines(), "app.trustintheweb.org", "app.trustweb.one", lineterm=""))


def app_org_redirect(text: str) -> str:
    """Only the page catch-all of the app.trustintheweb.org block becomes the 301 to app.trustweb.one."""
    if f"\n{APP_ONE_HEAD}\n" not in text:
        raise TransformError("the app.trustweb.one block does not exist yet: a redirect to a host that does not serve is refused")
    start, end = _site_block_span(text, APP_ORG_HEAD)
    block = text[start:end]
    if ORG_REDIRECT_CATCHALL in block:
        return text
    if block.count(ORG_SERVE_CATCHALL) != 1:
        raise TransformError(f"expected exactly one serving page catch-all in the {APP_ORG_HEAD!r} block, found {block.count(ORG_SERVE_CATCHALL)}")
    return text[:start] + block.replace(ORG_SERVE_CATCHALL, ORG_REDIRECT_CATCHALL) + text[end:]


TRANSFORMS: dict[Transform, Callable[[str], str]] = {
    Transform.SITES: add_sites,
    Transform.IDEA2_REDIRECT: idea2_redirect,
    Transform.EVOBIOSYS_REDIRECT: evobiosys_redirect,
    Transform.APP_TRUSTWEB_ONE: add_app_trustweb_one,
    Transform.DEMO_TRUSTWEB_ONE: add_demo_trustweb_one,
    Transform.APP_ORG_REDIRECT: app_org_redirect,
}


def apply(text: str, names: list[Transform]) -> str:
    for name in names:
        text = TRANSFORMS[name](text)
    return text


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--in", dest="src", required=True)
    parser.add_argument("--out", dest="dst")
    parser.add_argument("--parity", action="store_true", help="check that the two app blocks differ only in host, marker and the page catch-all")
    parser.add_argument("transforms", nargs="*", choices=[t.value for t in Transform])
    args = parser.parse_args(argv)
    with open(args.src, encoding="utf-8") as f:
        text = f.read()
    if args.parity:
        try:
            diff = app_block_parity(text)
        except TransformError as e:
            print(f"trustweb_domains_caddy: {e}", file=sys.stderr)
            return 1
        print("\n".join(diff) if diff else "parity ok: app.trustweb.one = app.trustintheweb.org except host, marker and the page catch-all")
        return 1 if diff else 0
    if not args.dst or not args.transforms:
        parser.error("--out and at least one transform are required (or --parity)")
    try:
        result = apply(text, [Transform(t) for t in args.transforms])
    except TransformError as e:
        print(f"trustweb_domains_caddy: {e}", file=sys.stderr)
        return 1
    with open(args.dst, "w", encoding="utf-8") as f:
        f.write(result)
    print("unchanged" if result == text else "changed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
