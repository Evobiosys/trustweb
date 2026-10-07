"""Assembles the TrustWeb site (idea2.site/trustweb) into a directory.

Called by scripts/build_tw_front_door.sh, which fetches the source page from
the server first and deploys the output afterwards. Nothing here touches the
network or the server.

    tw_site.py --src SOURCE_INDEX --frag FRAGMENT_DIR --out OUT_DIR
               [--draft] [--services-live] [--transcribe-live] [--publish-terms]

What it builds (see the fragments next to this file):
  index.html   the fetched idea2 web-of-trust page, edited by exact-text and
               regex replacements (a source that drifted fails loudly) plus
               the committed fragments
  why.html, pricing.html, feedback.html, faq.html, imprint.html, privacy.html
  terms.html   only with --draft or --publish-terms (Jakob has not approved it)

Conditional blocks in fragments: <!--IF:name-->...<!--/IF--> is kept when the
name is active and dropped otherwise. Names: soon / live (hosting is described
as "starting soon" until --services-live), tx-off / tx-on (server transcription
is described as "coming, switched off today" until --transcribe-live; it has its
own flag because it stays off until a provider key is placed, whatever hosting
does), draft / prod, terms. Blocks must not nest.

Every link between the site's own pages is relative, so the same output works
under /trustweb/ and under /trustweb/draft/.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

BLOCK_RE = re.compile(r"<!--IF:([\w-]+)-->(.*?)<!--/IF-->", re.DOTALL)
TW_URL = "https://idea2.site/trustweb/"


@dataclass(frozen=True)
class Flags:
    draft: bool
    services_live: bool
    transcribe_live: bool
    publish_terms: bool

    @property
    def terms_visible(self) -> bool:
        return self.draft or self.publish_terms

    def active_blocks(self) -> frozenset[str]:
        names = {
            "live" if self.services_live else "soon",
            "tx-on" if self.transcribe_live else "tx-off",
            "draft" if self.draft else "prod",
        }
        if self.terms_visible:
            names.add("terms")
        return frozenset(names)


@dataclass(frozen=True)
class Page:
    name: str
    title: str
    description: str
    body: str


PAGES: tuple[Page, ...] = (
    Page(
        "why",
        "Why TrustWeb",
        "The reasoning behind TrustWeb: scalable, discreet, targeted, and where it matters.",
        "why.body.html",
    ),
    Page(
        "pricing",
        "Pricing",
        "TrustWeb is free while we test. Hosting beyond the free allowance: contact us to make a solid agreement.",
        "pricing.body.html",
    ),
    Page(
        "feedback",
        "Feedback",
        "Send feedback or a bug report, ask to be told when TrustWeb is ready, or join the newsletter.",
        "feedback.body.html",
    ),
    Page(
        "faq",
        "FAQ",
        "Questions people ask about TrustWeb, answered as it works today.",
        "faq.body.html",
    ),
    Page(
        "imprint",
        "Imprint",
        "Imprint (Impressum, Offenlegung) of the TrustWeb site.",
        "imprint.body.html",
    ),
    Page(
        "privacy",
        "Privacy Policy",
        "What stays on your phone, what passes through the server, what this website does.",
        "privacy.body.html",
    ),
    Page(
        "terms",
        "Terms (draft)",
        "Draft terms for the experimental TrustWeb service. Not in force.",
        "terms.body.html",
    ),
)


class Doc:
    """A text under edit that remembers every expected spot it failed to find."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.missing: list[str] = []

    def replace(self, old: str, new: str, count: int = 0) -> None:
        if old not in self.text:
            self.missing.append(old)
            return
        self.text = (
            self.text.replace(old, new, count) if count else self.text.replace(old, new)
        )

    def regex(self, pattern: str, new: str) -> None:
        if not re.search(pattern, self.text, flags=re.DOTALL):
            self.missing.append(f"pattern: {pattern[:70]}...")
            return
        self.text = re.sub(pattern, lambda _m: new, self.text, count=1, flags=re.DOTALL)


def fragment(frag_dir: Path, name: str) -> str:
    return (frag_dir / name).read_text(encoding="utf-8")


def resolve_blocks(text: str, active: frozenset[str]) -> str:
    return BLOCK_RE.sub(lambda m: m.group(2) if m.group(1) in active else "", text)


def chrome_pieces(frag_dir: Path, flags: Flags) -> tuple[str, str]:
    """The site bar and the footer, resolved for the flags."""
    active = flags.active_blocks()
    return (
        resolve_blocks(fragment(frag_dir, "sitebar.html"), active),
        resolve_blocks(fragment(frag_dir, "site-footer.html"), active),
    )


def newsletter_script() -> str:
    """Second submit listener on the join form: subscribes to the newsletter when ticked."""
    return (
        "<script>\n"
        "(function () {\n"
        '  var form = document.getElementById("join-form");\n'
        '  var nl = document.getElementById("j-newsletter");\n'
        '  var status = document.getElementById("j-nl-status");\n'
        "  if (!form || !nl || !status) return;\n"
        "  function validEmail(v) { return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v); }\n"
        '  form.addEventListener("submit", function () {\n'
        "    if (!nl.checked) return;\n"
        '    status.className = "join-msg";\n'
        '    status.textContent = "";\n'
        '    var emailEl = document.getElementById("j-email");\n'
        "    var email = emailEl && emailEl.value.trim();\n"
        "    if (!email || !validEmail(email)) return; // the form's own required-field/pattern error already covers this\n"
        '    fetch("https://subscriber.questhub.eco/subscribe", {\n'
        '      method: "POST",\n'
        '      headers: { "Content-Type": "application/json" },\n'
        '      body: JSON.stringify({ email: email, project: "questhub", source: "trustweb", gdpr: true })\n'
        "    }).then(function (r) {\n"
        '      if (!r.ok) throw new Error("http_" + r.status);\n'
        '      status.className = "join-msg ok";\n'
        '      status.textContent = "Check your inbox to confirm the newsletter.";\n'
        "    }).catch(function () {\n"
        '      status.className = "join-msg err";\n'
        '      status.textContent = "Newsletter signup failed, please try again.";\n'
        "    });\n"
        "  });\n"
        "})();\n"
        "</script>\n"
    )


# ---- index.html -------------------------------------------------------------

JOINPANEL_OLD = (
    '  <div class="joinpanel">\n'
    '    <form id="join-form" novalidate>\n'
    '      <div class="joinrow">\n'
    '        <label for="j-email" class="skip">Email</label>\n'
    '        <input type="email" id="j-email" name="email" placeholder="you@example.org" required autocomplete="email">\n'
    '        <button type="submit" class="joinbtn" id="j-submit">Join TrustWeb</button>\n'
    "      </div>\n"
    '      <p class="join-err" id="j-err">Please enter a valid email.</p>\n'
    '      <p class="joinnote">Puts you on the waitlist. No accounts, no tracking, one note when the web widens.</p>\n'
    '      <p class="join-msg" role="status" id="j-msg"></p>\n'
    "    </form>\n"
    "  </div>\n"
)

SUBLINE_OLD = (
    '  <p class="subline">Permission-gated information sharing among organizations and'
    " in-person-verified communities.</p>\n"
    '  <div class="herochips">\n'
    '    <span class="chip strong">Connecting</span>\n'
    '    <span class="chip strong">Resource sharing through querying</span>\n'
    "  </div>\n"
)

TALKWEAVE_CARD_OLD = (
    '    <div class="ecocard">\n'
    "      <h3>TalkWeave</h3>\n"
    "      <p>Live conversation transcripts, local-first, feeding the same profile and resource graph.</p>\n"
    "    </div>\n"
)

DESCRIPTION_OLD = (
    '<meta name="description" content="Permission-gated information sharing among organizations and '
    'in-person-verified communities. Live demos, code, and how it works.">'
)
DESCRIPTION_NEW = (
    '<meta name="description" content="TrustWeb: find people and things through people you trust. '
    'Ask your web a question in plain words; each person decides what to share. An experimental app by EvoBioSys.">'
)


def edit_text_and_head(doc: Doc, frag_dir: Path, flags: Flags) -> None:
    """Retitle, rename the h1, set the head (description, canonical, robots)."""
    for old, new in (
        (
            "<title>Web of Trust · idea2.site</title>",
            "<title>TrustWeb · idea2.site</title>",
        ),
        ("Join the Web of Trust", "Join TrustWeb"),
        (
            "can reach through its own Web of Trust.",
            "can reach through its own TrustWeb.",
        ),
        (DESCRIPTION_OLD, DESCRIPTION_NEW),
    ):
        doc.replace(old, new)
    doc.replace(
        '<h1 class="wot">Web <span class="of">of</span> Trust</h1>',
        '<h1 class="wot">TrustWeb</h1>\n' + fragment(frag_dir, "hero-explainer.html"),
    )
    canonical_old = '<link rel="canonical" href="https://idea2.site/web-of-trust/">'
    if flags.draft:
        doc.replace(canonical_old, '<meta name="robots" content="noindex, nofollow">')
    else:
        doc.replace(canonical_old, f'<link rel="canonical" href="{TW_URL}">')


def edit_hero_and_chrome(doc: Doc, frag_dir: Path, flags: Flags) -> None:
    sitebar, _ = chrome_pieces(frag_dir, flags)
    skip_old = '<a class="skip" href="#main">Skip to content</a>\n'
    doc.replace(skip_old, skip_old + sitebar)
    doc.replace(SUBLINE_OLD, "")
    doc.replace(JOINPANEL_OLD, fragment(frag_dir, "hero-cta.html"))


def edit_ecosystem(doc: Doc) -> None:
    """SenseMeet and TalkWeave get links; SovSwitch and SoTranscribe join as a second row."""
    old_pair = (
        '    <div class="ecocard">\n'
        "      <h3>SenseMeet</h3>\n"
        "      <p>Meeting capture and QR share, so a room's decisions travel with the same consent-gated flow.</p>\n"
        "    </div>\n" + TALKWEAVE_CARD_OLD
    )
    sensemeet = (
        '    <div class="ecocard">\n'
        '      <h3><a href="https://sensemeet.org">SenseMeet ↗</a></h3>\n'
        "      <p>Meeting capture and QR share, so a room's decisions travel with the same consent-gated flow.</p>\n"
        "    </div>\n"
    )
    talkweave = (
        '    <div class="ecocard">\n'
        '      <h3><a href="https://evobiosys.org/talkweave/">TalkWeave ↗</a></h3>\n'
        "      <p>Live conversation transcripts, local-first, feeding the same profile and resource graph.</p>\n"
        "    </div>\n"
    )
    second_row = (
        '    <div class="ecocard">\n'
        '      <h3><a href="https://sovswitch.com">SovSwitch ↗</a></h3>\n'
        "      <p>Sovereign Switch: the pragmatic path off Big Tech, privacy without giving up your devices.</p>\n"
        "    </div>\n"
        '    <div class="ecocard">\n'
        '      <h3><a href="https://sotranscribe.com">SoTranscribe ↗</a></h3>\n'
        "      <p>Sovereign transcription: self-host on your own GPU, or use the hosted tier colocated in Austria.</p>\n"
        "    </div>\n"
    )
    doc.replace(old_pair, sensemeet + talkweave + second_row)


def edit_bottom_sections(doc: Doc, frag_dir: Path) -> None:
    """Source code, About us and the join form, just above the footer. The join form is the
    one extracted from the source hero, with a newsletter checkbox spliced in."""
    with_checkbox = JOINPANEL_OLD.replace(
        "      </div>\n"
        '      <p class="join-err" id="j-err">Please enter a valid email.</p>\n',
        "      </div>\n"
        '      <label class="nlcheck">'
        '<input type="checkbox" id="j-newsletter" name="newsletter"> '
        "Also put me on the newsletter</label>\n"
        '      <p class="join-msg" role="status" id="j-nl-status"></p>\n'
        '      <p class="join-err" id="j-err">Please enter a valid email.</p>\n',
    )
    if with_checkbox == JOINPANEL_OLD:
        doc.missing.append("joinpanel checkbox insertion point")
    bottom_join = (
        '<hr class="rule">\n\n'
        "<!-- ================= JOIN, AT THE BOTTOM ================= -->\n"
        '<section class="block joinbottom" id="join">\n'
        '  <div class="sechead">\n'
        '    <p class="chnum">Stay close</p>\n'
        "    <h2>Join TrustWeb</h2>\n"
        "  </div>\n" + with_checkbox + "</section>\n\n"
    )
    sections = (
        fragment(frag_dir, "source-code.html")
        + "\n"
        + fragment(frag_dir, "about-us.html")
    )
    doc.replace("<footer>", sections + "\n" + bottom_join + "<footer>", 1)
    doc.replace("</body>", newsletter_script() + "</body>", 1)
    doc.replace(
        '<h3 style="margin:0 0 6px;font:600 1.1rem var(--sans);color:var(--ink)">Jakob Possert-Bienzle</h3>',
        '<h3 style="margin:0 0 6px;font:600 1.1rem var(--sans);color:var(--ink)">Main Builder: Jakob Possert-Bienzle</h3>',
    )


def edit_sections(doc: Doc, frag_dir: Path) -> None:
    ecosystem_marker = (
        '<hr class="rule">\n\n<!-- ================= ECOSYSTEM ================= -->'
    )
    doc.replace(
        ecosystem_marker,
        fragment(frag_dir, "lineage.html") + "\n" + ecosystem_marker,
        1,
    )
    doc.replace(
        "</style>\n</head>",
        fragment(frag_dir, "chrome.css")
        + fragment(frag_dir, "style-additions.css")
        + "</style>\n</head>",
    )
    # the Live demos section and the old Code section go; the Code section's
    # replacement (Source code) was inserted above, as an honest statement.
    doc.regex(
        r'<hr class="rule">\n\n<!-- ================= LIVE DEMOS ================= -->\n'
        r'<section class="block" id="demos">.*?</section>\n\n',
        "",
    )
    doc.regex(
        r'<hr class="rule">\n\n<!-- ================= CODE ================= -->\n'
        r'<section class="block" id="code">.*?</section>\n\n',
        "",
    )
    how = (
        '<!-- ================= HOW IT WORKS ================= -->\n<section class="block" id="how">\n'
        + fragment(frag_dir, "how-it-works.html")
        + "\n</section>\n"
        + fragment(frag_dir, "game-phases.html")
        + "\n"
        + fragment(frag_dir, "specifically-useful.html")
        + "\n"
        + fragment(frag_dir, "features.html")
        + "\n"
        + fragment(frag_dir, "use-cases.html")
    )
    doc.regex(
        r"<!-- ================= HOW IT WORKS ================= -->\n"
        r'<section class="block" id="how">.*?</section>',
        how,
    )
    header_close = "</header>\n"
    doc.replace(
        header_close,
        header_close
        + "\n"
        + fragment(frag_dir, "for-ea-groups.html").rstrip("\n")
        + "\n",
        1,
    )


def edit_footer(doc: Doc, frag_dir: Path, flags: Flags) -> None:
    """The source footer sits inside main.wrap; the new one is full width, after </main>."""
    _, footer = chrome_pieces(frag_dir, flags)
    doc.regex(r"<footer>.*?</footer>\n</main>", "</main>\n" + footer)


def build_index(source: str, frag_dir: Path, flags: Flags) -> str:
    doc = Doc(source)
    edit_text_and_head(doc, frag_dir, flags)
    edit_hero_and_chrome(doc, frag_dir, flags)
    edit_ecosystem(doc)
    edit_bottom_sections(doc, frag_dir)
    edit_sections(doc, frag_dir)
    edit_footer(doc, frag_dir, flags)
    if doc.missing:
        raise SystemExit(
            "WARNING: expected text/pattern not found (source drifted since this script was written):\n"
            + "\n".join("  " + repr(m) for m in doc.missing)
        )
    return resolve_blocks(doc.text, flags.active_blocks())


# ---- subpages ---------------------------------------------------------------


def build_subpage(page: Page, frag_dir: Path, flags: Flags) -> str:
    active = flags.active_blocks()
    sitebar, footer = chrome_pieces(frag_dir, flags)
    shell = fragment(frag_dir, "subpage-shell.html")
    css = fragment(frag_dir, "subpage-base.css") + fragment(frag_dir, "chrome.css")
    body = resolve_blocks(fragment(frag_dir / "pages", page.body), active)
    values = {
        "ROBOTS": "noindex, nofollow",
        "TITLE": page.title,
        "DESCRIPTION": page.description,
        "CSS": css,
        "SITEBAR": sitebar,
        "BODY": body,
        "FOOTER": footer,
    }
    out = shell
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", value)
    return out


def pages_for(flags: Flags) -> list[Page]:
    return [p for p in PAGES if p.name != "terms" or flags.terms_visible]


def build_all(source: str, frag_dir: Path, out_dir: Path, flags: Flags) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    outputs = {"index.html": build_index(source, frag_dir, flags)}
    for page in pages_for(flags):
        outputs[f"{page.name}.html"] = build_subpage(page, frag_dir, flags)
    for name, text in outputs.items():
        (out_dir / name).write_text(text, encoding="utf-8")
        written.append(name)
    return written


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--src",
        required=True,
        type=Path,
        help="the fetched idea2 web-of-trust index.html",
    )
    ap.add_argument("--frag", required=True, type=Path, help="scripts/tw-front-door")
    ap.add_argument("--out", required=True, type=Path, help="output directory")
    ap.add_argument(
        "--draft",
        action="store_true",
        help="draft preview: noindex, draft strip, terms page",
    )
    ap.add_argument(
        "--services-live",
        action="store_true",
        help="describe hosting as live (default: starting soon)",
    )
    ap.add_argument(
        "--transcribe-live",
        action="store_true",
        help="describe server transcription as switched on (default: coming, off today)",
    )
    ap.add_argument(
        "--publish-terms",
        action="store_true",
        help="publish terms.html outside the draft",
    )
    return ap.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    flags = Flags(
        draft=args.draft,
        services_live=args.services_live,
        transcribe_live=args.transcribe_live,
        publish_terms=args.publish_terms,
    )
    written = build_all(
        args.src.read_text(encoding="utf-8"), args.frag, args.out, flags
    )
    print("built: " + " ".join(written))
    print(
        f"flags: draft={flags.draft} services_live={flags.services_live} "
        f"transcribe_live={flags.transcribe_live} terms={flags.terms_visible}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
