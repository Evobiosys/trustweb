"""Points a built TrustWeb site at its own host (wave 3, 2026-10-07).

scripts/tw-front-door/tw_site.py builds the site for idea2.site/trustweb, with
the app at app.idea2.site/trustweb/. scripts/build_tw_front_door.sh runs this
afterwards, in place on the built pages, when TW_SITE_HOST / TW_APP_ORIGIN name
another home (trustintheweb.org with the app at https://app.trustintheweb.org/):

  https://app.idea2.site/trustweb/...   ->  <app origin>/...      (Install, Demo)
  https://app.idea2.site/feedback       ->  <app origin>/feedback (the feedback form posts there)
  https://idea2.site/trustweb/...       ->  https://<site host>/... (canonical, og:url, own links)
  the visible "idea2.site" site label   ->  the site's own name   (title, eyebrow)

It is a post-processing step, not an edit of the fragments, so the fragments
stay host-neutral and the site agent's branding lands through the same build.
Afterwards it fails (exit 1, nothing written) if any of the rewritten URL
families is still in a page: a new fragment that names the old host is caught
here rather than shipped. Links to the older idea2 demos (app.idea2.site/wot/)
and to other projects stay as they are.

  python3 -I scripts/tw_site_rehost.py --dir <built pages> --site-host trustintheweb.org --app-origin https://app.trustintheweb.org
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

OLD_APP = "https://app.idea2.site/trustweb/"
OLD_APP_BARE = "https://app.idea2.site/trustweb"
OLD_FEEDBACK = "https://app.idea2.site/feedback"
OLD_SITE = "https://idea2.site/trustweb/"
OLD_SITE_BARE = "https://idea2.site/trustweb"

# What must be gone after the rewrite (a fragment naming the old homes in another spelling).
LEFTOVER = re.compile(r"https?://(?:www\.)?(?:app\.)?idea2\.site/(?:trustweb|feedback|tw)\b", re.IGNORECASE)

HOST_RE = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
ORIGIN_RE = re.compile(r"^https://(?P<host>[^/:]+)$")


class RehostError(Exception):
    """Bad arguments or a leftover old URL: nothing is written."""


def site_label(host: str) -> str:
    """The name the site calls itself: TrustInTheWeb.org for trustintheweb.org, the host otherwise."""
    if host.startswith("trustintheweb."):
        return "TrustInTheWeb." + host.split(".", 1)[1]
    return host


def rehost_text(text: str, site_host: str, app_origin: str) -> str:
    site = f"https://{site_host}/"
    app = app_origin + "/"
    label = site_label(site_host)
    # Longest first: the app's own pages before the bare app path, the site's pages before the bare site path.
    text = text.replace(OLD_APP, app).replace(OLD_APP_BARE, app_origin)
    text = text.replace(OLD_FEEDBACK, app_origin + "/feedback")
    text = text.replace(OLD_SITE, site).replace(OLD_SITE_BARE, f"https://{site_host}")
    # The visible site label (tw_site.py: "<title>TrustWeb · idea2.site</title>" and the hero eyebrow).
    text = text.replace(" · idea2.site</title>", f" · {label}</title>")
    text = text.replace('<span class="dot"></span> idea2.site</p>', f'<span class="dot"></span> {label}</p>')
    return text


def check_args(site_host: str, app_origin: str) -> None:
    if not HOST_RE.match(site_host):
        raise RehostError(f"not a host name: {site_host!r}")
    m = ORIGIN_RE.match(app_origin)
    if not m or not HOST_RE.match(m.group("host")):
        raise RehostError(f"not an https origin without a path: {app_origin!r}")


def rehost_dir(directory: Path, site_host: str, app_origin: str) -> list[str]:
    """Rewrites every *.html in `directory`; returns the names changed. All or nothing."""
    check_args(site_host, app_origin)
    pages = sorted(directory.glob("*.html"))
    if not pages:
        raise RehostError(f"no pages in {directory}")
    results: dict[Path, str] = {}
    for page in pages:
        new = rehost_text(page.read_text(encoding="utf-8"), site_host, app_origin)
        left = sorted(set(LEFTOVER.findall(new)))
        if left:
            raise RehostError(f"{page.name} still names the old home: {', '.join(left)}")
        results[page] = new
    changed = []
    for page, new in results.items():
        if page.read_text(encoding="utf-8") != new:
            page.write_text(new, encoding="utf-8")
            changed.append(page.name)
    return changed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", required=True, type=Path)
    parser.add_argument("--site-host", required=True)
    parser.add_argument("--app-origin", required=True)
    args = parser.parse_args(argv)
    try:
        changed = rehost_dir(args.dir, args.site_host, args.app_origin)
    except RehostError as e:
        print(f"tw_site_rehost: {e}", file=sys.stderr)
        return 1
    print(f"rehosted for {args.site_host} (app {args.app_origin}): {' '.join(changed) or 'nothing to change'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
