# SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
"""Builds the three TrustInTheWeb sites from the design system into a local directory. Touches no server.

    python3 -I scripts/tw-sites/build_sites.py --out <dir> [--indexable]

    <dir>/trustintheweb-org/   the project and its steward (trustintheweb.org)
    <dir>/trustintheweb-com/   hosting and services for groups and organisations (trustintheweb.com)
    <dir>/trustweb-one/        the app's own home: open, install, demo (trustweb.one)

One generator, one set of tokens (apps/trustweb/src/design/tokens.css), one skin per site (colour only), the brand SVGs
of apps/trustweb/src/brand, the theme and motion boot of apps/trustweb/src/design/boot_theme.inline.js. No external font,
script or image. Subpage bodies (legal, faq, why, pricing, feedback) are the fragments of scripts/tw-front-door/, rendered
through tw_site's block and token helpers. Own links stay relative; a link to a page another site owns turns into that
site's absolute URL, and a link that resolves nowhere fails the build.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
FRAG = REPO / "scripts" / "tw-front-door"
sys.path.insert(0, str(FRAG))
sys.path.insert(0, str(REPO / "scripts"))

import tw_site as ts  # noqa: E402
import tw_site_rehost  # noqa: E402

DESIGN = REPO / "apps" / "trustweb" / "src" / "design"
BRAND = REPO / "apps" / "trustweb" / "src" / "brand"
APP_ORIGIN = "https://app.trustweb.one"


@dataclass(frozen=True)
class SiteSpec:
    key: str
    dir: str
    host: str
    name: str
    kind: str  # ts.Site the shared fragments are rendered for
    mark: str  # logo colour in light; the dark colour sits in the skin
    tagline: str


SPECS: dict[str, SiteSpec] = {
    "org": SiteSpec("org", "trustintheweb-org", "trustintheweb.org", "TrustInTheWeb.org", "org", "#33456B",
                    "The project behind TrustWeb: what it is, why it exists, how it works, the source code."),
    "com": SiteSpec("com", "trustintheweb-com", "trustintheweb.com", "TrustInTheWeb.com", "com", "#4A9BD1",
                    "Hosting and services for TrustWeb, for groups and organisations."),
    "one": SiteSpec("one", "trustweb-one", "trustweb.one", "TrustWeb", "org", "#13847C",
                    "Ask the people you have met, and the people they trust. A question travels, the data stays."),
}
URL = {k: f"https://{s.host}/" for k, s in SPECS.items()}

# Colour layer per site (design doc 5.5: a skin overrides colour names only). Text on --trust needs 4.5:1, so the
# com light --trust is the deeper blue and the doc's #4A9BD1 stays the logo colour (--mark).
SKINS = {
    "com": (
        {"--mark": "#4A9BD1", "--trust": "#1F6FA8", "--trust-strong": "#175683", "--trust-tint": "#E2EFF8", "--focus": "#1F6FA8"},
        {"--mark": "#8FC6EE", "--trust": "#8FC6EE", "--trust-strong": "#B7DBF4", "--trust-tint": "#16293A", "--on-trust": "#0F2233", "--focus": "#8FC6EE"},
    ),
    "org": (
        {"--mark": "#33456B", "--trust": "#33456B", "--trust-strong": "#26345A", "--trust-tint": "#E4E8F1", "--focus": "#33456B"},
        {"--mark": "#8FA7D8", "--trust": "#8FA7D8", "--trust-strong": "#B5C5E8", "--trust-tint": "#232B45", "--on-trust": "#111726", "--focus": "#8FA7D8"},
    ),
}

# Pages and who owns them: a link to a page missing on one site goes to the first owner below.
OWNER_ORDER = ("org", "com", "one")
SUBPAGES: dict[str, tuple[str, ...]] = {
    "org": ("why", "feedback", "inspect", "faq", "imprint", "privacy", "data-policy", "history"),
    "com": ("pricing", "feedback", "imprint", "privacy", "data-policy"),
    "one": ("imprint", "privacy"),
}
PAGE_BY_NAME = {p.name: p for p in (*ts.ORG_PAGES, *ts.COM_PAGES)}
FONT_FREE_PAGES = {"privacy", "data-policy"}  # all three sites fetch no font, so these say "your own device"

HOME_FRAGMENTS = {
    "org": ("sites/org-hero.html", "features.html", "@how-it-works", "game-phases.html", "use-cases.html", "for-ea-groups.html", "source-code.html", "about-us.html"),
}
INDEX_META = {
    "org": ("Find people and things through people you trust", SPECS["org"].tagline),
    "com": ("Hosting for TrustWeb", SPECS["com"].tagline),
    "one": ("Ask the people you trust", SPECS["one"].tagline),
}

LINK_RE = re.compile(r'(?P<attr>\b(?:href|src))="(?P<url>[^"]*)"')
SCRIPT_RE = re.compile(r"(<script.*?</script>)", re.DOTALL)
ID_RE = re.compile(r'\bid="([^"]+)"')
EXTERNAL_RE = re.compile(r"(?:[a-z][a-z0-9+.-]*:|//)", re.IGNORECASE)


class BuildError(Exception):
    pass


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def frag(name: str) -> str:
    return read(FRAG / name)


def flags_for(spec: SiteSpec) -> ts.Flags:
    return ts.Flags(
        draft=False, services_live=False, transcribe_live=False, publish_terms=False,
        site=ts.Site(spec.kind), site_host=spec.host, app_base=APP_ORIGIN,
    )


def tokens_for(spec: SiteSpec) -> dict[str, str]:
    values = flags_for(spec).tokens()
    own = spec.key
    values.update(
        ORG="" if own == "org" else URL["org"],
        COM="" if own == "com" else URL["com"],
        BACK='<a class="back" href="./">&larr; Back to the front page</a>',
        SELF_URL=URL[own],
        SITE_NAME=spec.name,
    )
    return values


def render(text: str, spec: SiteSpec, active_site: str | None = None) -> str:
    """Resolve the <!--IF--> blocks and {{TOKENS}} of a fragment for one site; drop author comments."""
    flags = flags_for(spec)
    active = flags.active_blocks()
    if active_site:
        active = (active - {"org", "com"}) | {active_site}
    out = ts.HTML_COMMENT_RE.sub("", ts.resolve_blocks(text, active))
    values = tokens_for(spec)
    return ts.TOKEN_RE.sub(lambda m: values.get(m.group(1), m.group(0)), out)


def wordmark(spec: SiteSpec) -> str:
    svg = re.sub(r"<!--.*?-->\s*", "", read(BRAND / f"wordmark_{spec.key}.svg"), flags=re.DOTALL)
    svg = re.sub(r'(<circle cx="20" cy="20" r="5.5"[^>]*?)stroke="#[0-9A-Fa-f]{6}"', r'\1stroke="var(--mark)"', svg, count=1)
    if "var(--mark)" not in svg:
        raise BuildError(f"wordmark_{spec.key}.svg: mark colour not found")
    if spec.key == "one":  # wordmark_one.svg is 160 wide and clips the "b" of TrustWeb; widened here, the brand file stays
        svg = svg.replace('viewBox="0 0 160 40"', 'viewBox="0 0 180 40"', 1)
    label = "Trust in the Web" if spec.key != "one" else "TrustWeb"
    return svg.replace("<svg ", f'<svg class="wordmark" role="img" aria-label="{label}" ', 1).strip()


def favicon(spec: SiteSpec, dark_mark: str) -> str:
    ring = read(BRAND / "holarchic_ring.svg")
    body = re.sub(r"<!--.*?-->\s*", "", ring, flags=re.DOTALL)
    body = body.replace('stroke="currentColor"', 'class="m"').replace('stroke="var(--ink, #1F2A28)"', 'class="i"').replace('fill="var(--ink, #1F2A28)"', 'class="f"')
    style = (f"<style>.m{{stroke:{spec.mark}}}.i{{stroke:#1F2A28}}.f{{fill:#1F2A28}}"
             f"@media (prefers-color-scheme:dark){{.m{{stroke:{dark_mark}}}.i{{stroke:#F1EEE6}}.f{{fill:#F1EEE6}}}}</style>")
    return body.replace('fill="none">', f'fill="none">{style}', 1)


def skin_css(key: str) -> str:
    if key not in SKINS:
        return ""
    light, dark = SKINS[key]
    rule = lambda d: "".join(f"{k}:{v};" for k, v in d.items())  # noqa: E731
    sel = f':root[data-site="{key}"]'
    return (f"{sel}{{{rule(light)}}}\n{sel}[data-theme=\"dark\"]{{{rule(dark)}}}\n"
            f"@media (prefers-color-scheme:dark){{{sel}:not([data-theme=\"light\"]):not([data-theme=\"dark\"]){{{rule(dark)}}}}}\n")


def site_css(key: str) -> str:
    return "\n".join((read(DESIGN / "tokens.css"), skin_css(key), read(HERE / "sites.css")))


THEME_JS = """(function(){var b=document.querySelector('.theme-btn');if(!b)return;var order=['system','light','dark'];
function show(){b.textContent='Theme: '+document.documentElement.dataset.theme;}
b.addEventListener('click',function(){var t=order[(order.indexOf(document.documentElement.dataset.theme)+1)%3];
document.documentElement.dataset.theme=t;try{if(t==='system')localStorage.removeItem('tw-theme');else localStorage.setItem('tw-theme',t);}catch(e){}show();});show();})();"""


def nav_links(spec: SiteSpec) -> str:
    app = f'<a href="{APP_ORIGIN}/">Open the app</a>'
    return {
        "org": f'<a href="./#features">Features</a><a href="why.html">The vision</a><a href="faq.html">FAQ</a>{app}',
        "com": f'<a href="pricing.html">Pricing</a><a href="feedback.html?kind=pricing">Contact us</a><a href="{URL["org"]}">The project</a>',
        "one": f'<a href="{APP_ORIGIN}/demo/">Demo</a><a href="{URL["org"]}">The project</a><a href="{URL["com"]}">Hosting</a>',
    }[spec.key]


def header(spec: SiteSpec) -> str:
    return (f'<div class="topbar"><div class="topbar-in"><a class="wordmark-link" href="./" aria-label="{spec.name}, front page">{wordmark(spec)}</a>'
            f'<nav class="topnav" aria-label="Site">{nav_links(spec)}<button type="button" class="theme-btn">Theme</button></nav></div></div>')


def footer(spec: SiteSpec) -> str:
    roles = {"org": "The project and its steward", "com": "Hosting and services", "one": "The app's own home"}
    sites = "".join(
        f'<li><a href="{URL[k]}">{SPECS[k].host}</a><span class="sf-role">{roles[k]}</span></li>'
        for k in OWNER_ORDER if k != spec.key
    )
    own = "".join(f'<li><a href="{href}">{label}</a></li>' for href, label in own_links(spec))
    legal = ['<li><a href="privacy.html">Privacy Policy</a></li>', '<li><a href="data-policy.html">Data policy</a></li>', '<li><a href="imprint.html">Imprint</a></li>']
    return (f'<footer class="sitefooter"><div class="sitefooter-in"><nav class="sf-cols" aria-label="Footer">'
            f'<div class="sf-col"><h2 class="sf-h">{spec.name}</h2><ul>{own}</ul></div>'
            f'<div class="sf-col"><h2 class="sf-h">The other two sites</h2><ul>{sites}</ul></div>'
            f'<div class="sf-col"><h2 class="sf-h">The app</h2><ul><li><a href="{APP_ORIGIN}/">Open the app</a></li>'
            f'<li><a href="{APP_ORIGIN}/?install=1">Install</a></li><li><a href="{APP_ORIGIN}/demo/">Demo</a></li></ul></div>'
            f'<div class="sf-col"><h2 class="sf-h">Legal</h2><ul>{"".join(legal)}</ul></div></nav>'
            '<p class="sf-fine">No analytics, no tracking cookies, no outside fonts. An experimental first version, part of '
            '<a href="https://evobiosys.org">EvoBioSys</a>. <a href="mailto:connect@evobiosys.org">connect@evobiosys.org</a></p>'
            '<p class="sf-love">with love from Vienna</p></div></footer>')


def own_links(spec: SiteSpec) -> list[tuple[str, str]]:
    return {
        "org": [("./", "Front page"), ("./#features", "Features"), ("./#how-it-works", "How it works"), ("./#phases", "The game phases"),
                ("./#source-code", "Source code"), ("why.html", "The vision"), ("faq.html", "FAQ"), ("inspect.html", "Inspect us"),
                ("history.html", "History"), ("feedback.html", "Feedback")],
        "com": [("./", "Front page"), ("pricing.html", "Pricing"), ("feedback.html?kind=pricing", "Contact us")],
        "one": [("./", "Front page")],
    }[spec.key]


def page_html(spec: SiteSpec, title: str, description: str, body: str, *, main_class: str, robots: str) -> str:
    return f"""<!doctype html>
<html lang="en" data-site="{spec.key}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="{robots}">
<title>{title} &middot; {spec.name}</title>
<meta name="description" content="{description}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<script>
{read(DESIGN / "boot_theme.inline.js").strip()}
</script>
<link rel="stylesheet" href="site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{header(spec)}
<main id="main" class="wrap {main_class}">
{body}
</main>
{footer(spec)}
<script>
{THEME_JS}
</script>
</body>
</html>
"""


def home_body(spec: SiteSpec) -> str:
    if spec.key != "org":
        text = read(FRAG / "sites" / f"{spec.key}-index.body.html")
        if spec.key == "com":
            text = text.replace("{{EA_GROUPS}}", frag("for-ea-groups.html").replace('<hr class="rule">', ""))
        return render(text, spec, active_site="com")
    parts: list[str] = []
    for name in HOME_FRAGMENTS["org"]:
        if name == "@how-it-works":
            parts.append(f'<hr class="rule"><section class="block" id="how-it-works">{frag("how-it-works.html")}</section>')
            continue
        text = frag(name)
        if name == "use-cases.html":
            old = '<a href="#useful">where it is specifically useful</a>'
            if old not in text:
                raise BuildError("use-cases.html: the #useful link moved; update build_sites.py")
            text = text.replace(old, '<a href="why.html">the vision</a>')
        parts.append(text)
    return render("\n".join(parts), spec, active_site="com")


def sub_body(spec: SiteSpec, name: str) -> str:
    page = PAGE_BY_NAME[name]
    active_site = "com" if name in FONT_FREE_PAGES else None
    return render(frag(page.body), spec, active_site=active_site)


def fix_links(html: str, spec: SiteSpec, ids: dict[str, dict[str, set[str]]], page: str) -> str:
    """Relative links stay if they resolve in this site; a page or anchor another site owns becomes that site's absolute URL."""
    problems: list[str] = []

    def fix(m: re.Match[str]) -> str:
        url = m.group("url")
        if url == "" or EXTERNAL_RE.match(url):
            return m.group(0)
        base, _, frag_id = url.partition("#")
        file, has_query, query = base.partition("?")
        file = {"": page, ".": "index.html", "./": "index.html"}.get(file, file)
        if not file.endswith(".html"):
            return m.group(0)  # an asset of this site (css, icon, manifest)
        for owner in (spec.key, *[k for k in OWNER_ORDER if k != spec.key]):
            page_ids = ids[owner].get(file)
            if page_ids is not None and (not frag_id or frag_id in page_ids):
                if owner == spec.key:
                    return m.group(0)
                target = URL[owner] + ("" if file == "index.html" else file) + (f"?{query}" if has_query else "") + (f"#{frag_id}" if frag_id else "")
                return f'{m.group("attr")}="{target}"'
        problems.append(f"{spec.key}/{page}: {url}")
        return m.group(0)

    parts = SCRIPT_RE.split(html)
    fixed = [p if i % 2 else LINK_RE.sub(fix, p) for i, p in enumerate(parts)]
    if problems:
        raise BuildError("unresolved links: " + "; ".join(sorted(set(problems))))
    return "".join(fixed)


def manifest(spec: SiteSpec) -> str:
    import json
    return json.dumps({
        "id": "./", "name": spec.name, "short_name": spec.name if spec.key == "one" else spec.host, "description": spec.tagline,
        "start_url": "./", "scope": "./", "display": "browser", "theme_color": spec.mark, "background_color": "#F5F0E8",
        "icons": [
            {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }, indent=2) + "\n"


def build_all(out: Path, *, indexable: bool = False) -> dict[str, Path]:
    robots = "index, follow" if indexable else "noindex, nofollow"
    # First pass: raw pages per site, so link fixing sees every site's ids.
    raw: dict[str, dict[str, tuple[str, str, str, str]]] = {k: {} for k in SPECS}
    for key, spec in SPECS.items():
        title, desc = INDEX_META[key]
        raw[key]["index.html"] = (title, desc, home_body(spec), "home")
        for name in SUBPAGES[key]:
            page = PAGE_BY_NAME[name]
            raw[key][f"{name}.html"] = (page.title, page.description, sub_body(spec, name), "sub")
    html: dict[str, dict[str, str]] = {
        key: {file: page_html(SPECS[key], t, d, b, main_class=c, robots=robots) for file, (t, d, b, c) in pages.items()}
        for key, pages in raw.items()
    }
    ids = {key: {file: set(ID_RE.findall(text)) for file, text in pages.items()} for key, pages in html.items()}
    dirs: dict[str, Path] = {}
    for key, spec in SPECS.items():
        target = out / spec.dir
        target.mkdir(parents=True, exist_ok=True)
        for file, text in html[key].items():
            (target / file).write_text(fix_links(text, spec, ids, file), encoding="utf-8")
        (target / "site.css").write_text(site_css(key), encoding="utf-8")
        (target / "favicon.svg").write_text(favicon(spec, SKINS[key][1]["--mark"] if key in SKINS else "#2BA59B"), encoding="utf-8")
        (target / "site.webmanifest").write_text(manifest(spec), encoding="utf-8")
        for icon in (HERE / "assets" / key).glob("*.png"):
            shutil.copy2(icon, target / icon.name)
        tw_site_rehost.rehost_dir(target, spec.host, APP_ORIGIN)
        dirs[key] = target
    return dirs


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--indexable", action="store_true", help="robots index,follow (default noindex until the sites go live)")
    args = parser.parse_args(argv)
    try:
        dirs = build_all(args.out, indexable=args.indexable)
    except (BuildError, tw_site_rehost.RehostError) as e:
        print(f"build_sites: {e}", file=sys.stderr)
        return 1
    for key, path in dirs.items():
        print(f"{SPECS[key].host}: {path} ({len(list(path.glob('*.html')))} pages)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
