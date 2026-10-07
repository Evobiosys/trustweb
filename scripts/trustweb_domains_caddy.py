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
"""
from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from enum import Enum

QUESTHUB_STATIC = "/srv/questhub-static"
SITE_ORG_DIR = f"{QUESTHUB_STATIC}/trustintheweb-org"
SITE_COM_DIR = f"{QUESTHUB_STATIC}/trustintheweb-com"
APP_DIR = f"{QUESTHUB_STATIC}/app-trustintheweb"
BACKUP_UPSTREAM = "127.0.0.1:8960"
RELAY_UPSTREAM = "127.0.0.1:4177"

SITES_MARKER = "# --- TrustInTheWeb domains (wave 3, scripts/trustweb_domains.sh) ---"
IDEA2_MARKER = "# TrustInTheWeb migration (wave 3, 2026-10-07):"
EVOBIOSYS_MARKER = "# TrustInTheWeb (wave 3, 2026-10-07):"


class TransformError(Exception):
    """An anchor the transform needs is not in the file: nothing is written."""


class Transform(str, Enum):
    SITES = "sites"
    IDEA2_REDIRECT = "idea2-redirect"
    EVOBIOSYS_REDIRECT = "evobiosys-redirect"


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
IDEA2_NEW_SERVE = f"""	{IDEA2_MARKER} the site moved to https://trustintheweb.org.
	# /trustweb and every page under it answer 301 to the same page there (the deployed app links
	# to idea2.site/trustweb/faq.html etc.: those keep working). /trustweb/draft/ still serves the
	# draft folder (scripts/build_tw_front_door.sh --draft). Rollback: Caddyfile.bak.<ts> of that day.
	@trustweb_bare path /trustweb
	redir @trustweb_bare https://trustintheweb.org/ permanent
	@trustweb_draft_bare path /trustweb/draft
	redir @trustweb_draft_bare /trustweb/draft/ 308
	handle_path /trustweb/draft/* {{
		root * /srv/questhub-static/idea2-tw/draft
		file_server
	}}
	handle_path /trustweb/* {{
		redir https://trustintheweb.org{{uri}} permanent
	}}
"""
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
        return text
    header = "idea2.site, www.idea2.site {"
    text = _replace_once_in_block(text, header, IDEA2_OLD_SERVE, IDEA2_NEW_SERVE)
    return _replace_once_in_block(text, header, IDEA2_OLD_ALIAS, IDEA2_NEW_ALIAS)


def evobiosys_redirect(text: str) -> str:
    if EVOBIOSYS_MARKER in text:
        return text
    return _replace_once_in_block(text, "evobiosys.org, www.evobiosys.org {", EVOBIOSYS_ANCHOR, EVOBIOSYS_INSERT + EVOBIOSYS_ANCHOR)


TRANSFORMS: dict[Transform, Callable[[str], str]] = {
    Transform.SITES: add_sites,
    Transform.IDEA2_REDIRECT: idea2_redirect,
    Transform.EVOBIOSYS_REDIRECT: evobiosys_redirect,
}


def apply(text: str, names: list[Transform]) -> str:
    for name in names:
        text = TRANSFORMS[name](text)
    return text


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--in", dest="src", required=True)
    parser.add_argument("--out", dest="dst", required=True)
    parser.add_argument("transforms", nargs="+", choices=[t.value for t in Transform])
    args = parser.parse_args(argv)
    with open(args.src, encoding="utf-8") as f:
        text = f.read()
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
