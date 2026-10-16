"""Assembles the TrustInTheWeb sites into a directory: the website (org) and the hosting site (com).

Called by scripts/build_tw_front_door.sh, which fetches the source page from
the server first and deploys the output afterwards. Nothing here touches the
network or the server.

    tw_site.py --src SOURCE_INDEX --frag FRAGMENT_DIR --out OUT_DIR
               [--draft] [--services-live] [--transcribe-live] [--hops-live] [--publish-terms]
               [--transcribe-provider openrouter|berget|berget-only]
               [--site org|com] [--site-host HOST] [--app-base URL]

--site org (default) builds TrustInTheWeb.org, --site com builds
TrustInTheWeb.com (the hosted service, with the pricing). --site-host is the
host the output is served from (default idea2.site, where the org site lives
under /trustweb/ until it moves); --app-base is the app's base URL (default
https://app.idea2.site/trustweb; on the new hosts https://app.trustweb.one, formerly https://app.trustintheweb.org).
Every default reproduces the pre-wave-3 build, so an older caller still works.

What it builds (see the fragments next to this file):
  org: index.html   the fetched idea2 web-of-trust page, edited by exact-text and
                    regex replacements (a source that drifted fails loudly) plus
                    the committed fragments
       why.html, feedback.html, faq.html, imprint.html, privacy.html, whitepaper.html
       data-policy.html (wave 5), terms.html only with --draft or --publish-terms (both sites)
       No pricing anywhere: only a link "Do you need hosting?" to the com site.
  com: index.html (the hosted service), pricing.html, feedback.html, imprint.html, privacy.html
       (feedback, imprint and privacy are the same fragments as on the org site)

Conditional blocks in fragments: <!--IF:name-->...<!--/IF--> is kept when the
name is active and dropped otherwise. Names: soon / live (hosting is described
as "starting soon" until --services-live), tx-off / tx-on (server transcription
is described as "coming, switched off today" until --transcribe-live; it has its
own flag because it stays off until a provider key is placed, whatever hosting
does), hops-off / hops-on (wave 6: the copy that says a question reaches only your direct connections today, versus
the copy that says it can travel on through friends and you choose how far; hops-on only with --hops-live, which the
orchestrator passes once the app that relays a question through friends is live), inperson-off / inperson-on (wave 6b: the copy
describing meeting in person with QR scan and code link; inperson-lookup-off/on for typing code/name/DID; inperson-advanced-off/on for
advanced sharing choices), draft / prod, org / com, terms.
Blocks must not nest.

TRANSCRIPTION PROVIDER FLAG (who the copy says transcribes on the server). The words on privacy, pricing
and the third-party list name the provider that really runs, never one that does not:
  TW_TRANSCRIBE_PROVIDER=openrouter    (default) OpenRouter, a US inference provider behind it; no Berget wording anywhere
  TW_TRANSCRIBE_PROVIDER=berget        Berget AI (Sweden) first, OpenRouter (US) as the fallback when Berget is down or cannot
                                       take the file type (the server's default chain, TRANSCRIBE_PROVIDER=auto)
  TW_TRANSCRIBE_PROVIDER=berget-only   Berget AI (Sweden) alone, no fallback (TRANSCRIBE_FALLBACK=none)
Read from the environment here (or --transcribe-provider; the flag wins); scripts/build_tw_front_door.sh passes it on.
The orchestrator flips it to berget or berget-only in the same step that switches Berget on and the server's status
(GET /hosted/status, provider.transcribe) reads that provider. Blocks: prov-openrouter / prov-berget / prov-berget-only;
the token {{TX_ROUTE}} carries the short phrase used in headings and sentences.

LOOK. The two sites are one family with two faces. org wears the cream and navy palette with Fraunces and IBM Plex (Google Fonts);
com (fragments in com/, look in com/theme.css) wears the inverse: dark where org is light and light where org is dark, the
wine red as primary and the navy as accent, and device typefaces only (no font is fetched, so the com pages contact no third party).

Tokens in fragments, replaced in the finished page: {{APP}} app base, {{API}}
app origin, {{ORG}} / {{COM}} prefix of a link to the other site (empty for the
own site, so own links stay relative), {{SELF_URL}}, {{WHITEPAPER}},
{{SITE_NAME}}, {{SITE_KIND}} (org or com), {{BACK}}, and the fragments {{WORDMARK}}, {{SWIRLS}} and
{{DEMO_BUTTON}} (wave 6: the "Open the live demo" button under the hero text, one source in demo-button.html
for both sites; its class token {{DEMO_BTN_CLASS}} picks the button style each site defines).

Every link between the site's own pages is relative, so the same output works
under /trustweb/, under /trustweb/draft/ and at the root of a domain.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from urllib.parse import urlsplit

BLOCK_RE = re.compile(r"<!--IF:([\w-]+)-->(.*?)<!--/IF-->", re.DOTALL)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
TOKEN_RE = re.compile(r"\{\{([A-Z_]+)\}\}")
IDEA2_HOST = "idea2.site"
IDEA2_URL = "https://idea2.site/trustweb/"
DEFAULT_APP_BASE = "https://app.idea2.site/trustweb"
ORG_HOST = "trustintheweb.org"
COM_HOST = "trustintheweb.com"
ORG_LIVE_URL = f"https://{ORG_HOST}/"
COM_LIVE_URL = f"https://{COM_HOST}/"
WHITEPAPER_ANCHOR = "whitepaper.html#bonobos"
# Wave 11: the Android app, published as a GitHub Release asset by .github/workflows/android-release.yml.
APK_URL = "https://github.com/Evobiosys/trustweb/releases/latest/download/trustweb.apk"
COM_THEME = "com/theme.css"  # the hosting site's own palette and typefaces, appended after the shared CSS


class Site(str, Enum):
    ORG = "org"
    COM = "com"


class TranscribeProvider(str, Enum):
    OPENROUTER = "openrouter"
    BERGET = "berget"
    BERGET_ONLY = "berget-only"


TRANSCRIBE_PROVIDER_ENV = "TW_TRANSCRIBE_PROVIDER"
# The short phrase each provider setting puts where a sentence or heading names the transcription route.
TX_ROUTE: dict[TranscribeProvider, str] = {
    TranscribeProvider.OPENROUTER: "outside providers via OpenRouter",
    TranscribeProvider.BERGET: "Berget AI in Sweden, with OpenRouter in the United States as a fallback",
    TranscribeProvider.BERGET_ONLY: "Berget AI in Sweden",
}


@dataclass(frozen=True)
class Flags:
    draft: bool
    services_live: bool
    transcribe_live: bool
    publish_terms: bool
    site: Site = Site.ORG
    site_host: str = IDEA2_HOST
    app_base: str = DEFAULT_APP_BASE
    transcribe_provider: TranscribeProvider = TranscribeProvider.OPENROUTER
    hops_live: bool = False
    inperson_live: bool = False
    inperson_lookup: bool = False
    inperson_advanced: bool = False
    code_public: bool = False

    @property
    def terms_visible(self) -> bool:
        return self.draft or self.publish_terms

    @property
    def is_org(self) -> bool:
        return self.site is Site.ORG

    @property
    def self_url(self) -> str:
        """Absolute URL of this site's front page (canonical, lineage link)."""
        if self.site_host == IDEA2_HOST:
            return IDEA2_URL if self.is_org else COM_LIVE_URL
        return f"https://{self.site_host}/"

    @property
    def api_origin(self) -> str:
        parts = urlsplit(self.app_base)
        return f"{parts.scheme}://{parts.netloc}"

    def active_blocks(self) -> frozenset[str]:
        names = {
            "live" if self.services_live else "soon",
            "tx-on" if self.transcribe_live else "tx-off",
            "hops-on" if self.hops_live else "hops-off",
            "inperson-on" if self.inperson_live else "inperson-off",
            # The two sub-flags describe parts of the live in-person flow: alone they render nothing (review 6b).
            "inperson-lookup-on" if self.inperson_live and self.inperson_lookup else "inperson-lookup-off",
            "inperson-advanced-on" if self.inperson_live and self.inperson_advanced else "inperson-advanced-off",
            f"prov-{self.transcribe_provider.value}",
            "draft" if self.draft else "prod",
            self.site.value,
        }
        if self.terms_visible:
            names.add("terms")
        if self.code_public:
            names.add("code-public")
        return frozenset(names)

    def tokens(self) -> dict[str, str]:
        """Plain-text tokens; the fragment tokens WORDMARK and SWIRLS are added by the builder."""
        # In production on the website's own host the link is the absolute anchor Jakob named;
        # in a draft or on a preview host it stays relative, so it resolves inside that copy.
        relative = self.is_org and (self.draft or self.site_host != ORG_HOST)
        whitepaper = WHITEPAPER_ANCHOR if relative else ORG_LIVE_URL + WHITEPAPER_ANCHOR
        back = (
            '<a class="back" href="./">&larr; back to TrustInTheWeb.org</a>'
            if self.is_org
            else '<a class="back" href="./">&larr; back to the hosted service</a>'
        )
        return {
            "APP": self.app_base.rstrip("/"),
            "APK": APK_URL,
            "API": self.api_origin,
            "ORG": "" if self.is_org else ORG_LIVE_URL,
            "COM": COM_LIVE_URL if self.is_org else "",
            "SELF_URL": self.self_url,
            "WHITEPAPER": whitepaper,
            "SITE_NAME": "TrustInTheWeb.org" if self.is_org else "TrustInTheWeb.com",
            "SITE_KIND": self.site.value,
            "TX_ROUTE": TX_ROUTE[self.transcribe_provider],
            "DEMO_BTN_CLASS": "joinbtn" if self.is_org else "btn-primary",
            "BACK": back,
            "AI_DRAFT": AI_DRAFT_BANNER,
        }


# Wave 5: every legal page opens with this banner (Jakob 2026-10-07: "ai drafted subject to review").
AI_DRAFT_BANNER = (
    '<aside class="banner ai-draft" role="note"><b>AI drafted, subject to review.</b> '
    "This text was written with the help of AI and has not been through a legal review yet.</aside>"
)


@dataclass(frozen=True)
class Page:
    name: str
    title: str
    description: str
    body: str  # path of the body fragment, relative to the fragment directory


ORG_PAGES: tuple[Page, ...] = (
    Page(
        "why",
        "Why TrustWeb",
        "The vision: the reasoning behind TrustWeb, scalable, discreet, targeted, and where it matters.",
        "pages/why.body.html",
    ),
    Page(
        "feedback",
        "Feedback",
        "Send feedback or a bug report, ask to be told when TrustWeb is ready, or join the newsletter.",
        "pages/feedback.body.html",
    ),
    Page(
        "faq",
        "FAQ",
        "Questions people ask about TrustWeb, answered as it works today.",
        "pages/faq.body.html",
    ),
    Page(
        "imprint",
        "Imprint",
        "Imprint (Impressum, Offenlegung) of the TrustInTheWeb sites. AI drafted, subject to review.",
        "pages/imprint.body.html",
    ),
    Page(
        "privacy",
        "Privacy Policy",
        "What stays on your phone, what passes through the server, what this website does. AI drafted, subject to review.",
        "pages/privacy.body.html",
    ),
    Page(
        "data-policy",
        "Data policy",
        "Every kind of data TrustWeb handles: what, where it lives, how long, who can read it, how to delete it. AI drafted, subject to review.",
        "pages/data-policy.body.html",
    ),
    Page(
        "terms",
        "Terms",
        "The terms for using TrustWeb and the experimental hosted service. AI drafted, subject to review.",
        "pages/terms.body.html",
    ),
    Page(
        "whitepaper",
        "White paper",
        "The TrustWeb white paper: outline in progress.",
        "pages/whitepaper.body.html",
    ),
    Page(
        "history",
        "History",
        "TrustWeb's versions so far, what each one proved, and what comes next.",
        "pages/history.body.html",
    ),
)

COM_PAGES: tuple[Page, ...] = (
    Page(
        "index",
        "Hosting",
        "The hosted TrustWeb service: free while we test, smooth updates, and a solid agreement when you need more.",
        "com/pages/index.body.html",
    ),
    Page(
        "pricing",
        "Pricing",
        "TrustWeb hosting is free while we test. Beyond the free allowance: contact us to make a solid agreement.",
        "com/pages/pricing.body.html",
    ),
    ORG_PAGES[1],  # feedback (same fragment as the website)
    *(p for p in ORG_PAGES if p.name in ("imprint", "privacy", "data-policy", "terms")),
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
    """The site bar and the footer, resolved for the flags (the com site has its own pair)."""
    active = flags.active_blocks()
    folder = "" if flags.is_org else "com/"
    return (
        resolve_blocks(fragment(frag_dir, folder + "sitebar.html"), active),
        resolve_blocks(fragment(frag_dir, folder + "site-footer.html"), active),
    )


FRAGMENT_TOKENS = frozenset({"WORDMARK", "SWIRLS", "DEMO_BUTTON"})


def fill_tokens(text: str, frag_dir: Path, flags: Flags) -> str:
    """Replace {{TOKEN}} with the site's values; the fragment tokens expand first, so
    tokens inside them resolve too. An unknown token is left in place (verify_site fails on it)."""
    values = {
        **flags.tokens(),
        "WORDMARK": fragment(frag_dir, "wordmark.html").strip(),
        "SWIRLS": fragment(frag_dir, "swirls.html").strip(),
        "DEMO_BUTTON": fragment(frag_dir, "demo-button.html").strip(),
    }
    expanded = TOKEN_RE.sub(
        lambda m: values[m.group(1)] if m.group(1) in FRAGMENT_TOKENS else m.group(0),
        text,
    )
    return TOKEN_RE.sub(lambda m: values.get(m.group(1), m.group(0)), expanded)


WAITLIST_COPY = "You can use it right now. If you want to be notified once it is stable, leave your email here."
# Wave 5: the source page's join form posted straight to the ReBioSys relay (idea2.site/rebiosys/api/waitlist) and
# the newsletter box straight to the subscriber service. Neither allows the TrustInTheWeb origins in its CORS
# answer, so a browser on trustintheweb.org could not send them. The form now posts once to this site's own
# feedback route ({{API}}/feedback, which allows the TrustInTheWeb origins, stores no network address, and itself
# forwards a ticked newsletter box to the subscriber service with double opt-in).
JOIN_SCRIPT_RE = (
    r'<script>\n\(function \(\) \{\n  "use strict";\n  var form = document\.getElementById\("join-form"\);'
    r".*?\}\)\(\);\n</script>\n"
)


def join_script() -> str:
    """The notify form: one JSON POST to the feedback route, notify:true, newsletter when the box is ticked."""
    return (
        "<script>\n"
        "(function () {\n"
        '  "use strict";\n'
        '  var FEEDBACK_URL = "{{API}}/feedback";\n'
        "  var TIMEOUT_MS = 15000;\n"
        '  var form = document.getElementById("join-form");\n'
        '  var emailEl = document.getElementById("j-email");\n'
        '  var nl = document.getElementById("j-newsletter");\n'
        '  var errEl = document.getElementById("j-err");\n'
        '  var msgEl = document.getElementById("j-msg");\n'
        '  var nlMsgEl = document.getElementById("j-nl-status");\n'
        '  var btn = document.getElementById("j-submit");\n'
        "  if (!form || !emailEl || !nl || !errEl || !msgEl || !nlMsgEl || !btn) return;\n"
        "  function validEmail(v) { return v.length <= 254 && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v); }\n"
        "  function setMsg(kind, text) {\n"
        '    msgEl.className = "join-msg " + kind;\n'
        "    msgEl.textContent = text;\n"
        "  }\n"
        '  form.addEventListener("submit", function (ev) {\n'
        "    ev.preventDefault();\n"
        "    var email = emailEl.value.trim();\n"
        "    var bad = !validEmail(email);\n"
        '    errEl.style.display = bad ? "block" : "none";\n'
        '    if (bad) { setMsg("", ""); return; }\n'
        "    btn.disabled = true;\n"
        '    nlMsgEl.className = "join-msg";\n'
        '    nlMsgEl.textContent = "";\n'
        "    var controller = new AbortController();\n"
        "    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);\n"
        "    fetch(FEEDBACK_URL, {\n"
        '      method: "POST",\n'
        '      headers: { "Content-Type": "application/json" },\n'
        "      signal: controller.signal,\n"
        '      body: JSON.stringify({ kind: "feedback", text: "", page: "main page: notify me when stable", notify: true, newsletter: nl.checked, email: email })\n'
        "    }).then(function (r) {\n"
        '      if (r.status === 429) { setMsg("err", "Several requests came in a short time. Please try again in a while."); return; }\n'
        '      if (!r.ok) throw new Error("http_" + r.status);\n'
        '      setMsg("ok", "Thank you. We will write to you once, when it is stable.");\n'
        "      if (nl.checked) {\n"
        '        nlMsgEl.className = "join-msg ok";\n'
        '        nlMsgEl.textContent = "A confirmation email will follow; you join the newsletter only after you click the link in it.";\n'
        "      }\n"
        "      form.reset();\n"
        "    }).catch(function () {\n"
        '      setMsg("err", "Could not send right now. Please try again later, or write to connect@evobiosys.org.");\n'
        "    }).finally(function () { clearTimeout(timer); btn.disabled = false; });\n"
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
    'Call into your web with a question in plain words; each person decides what to share. An experimental app by EvoBioSys.">'
)


def edit_text_and_head(doc: Doc, frag_dir: Path, flags: Flags) -> None:
    """Retitle, rename the h1, set the head (description, canonical, robots)."""
    for old, new in (
        (
            "<title>Web of Trust · idea2.site</title>",
            "<title>TrustInTheWeb.org</title>",
        ),
        # the small site label above the wordmark is gone (wave 4): the bar already names the site
        ('  <p class="eyebrow"><span class="dot"></span> idea2.site</p>\n', ""),
        (
            "We have always trusted our friends,",
            'We have <a class="alwayslink" href="{{WHITEPAPER}}">always</a> trusted our friends,',
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
        "{{WORDMARK}}\n" + fragment(frag_dir, "hero-explainer.html"),
    )
    doc.regex(r'<div class="knot-field" aria-hidden="true">.*?</div>\n', "{{SWIRLS}}\n")
    canonical_old = '<link rel="canonical" href="https://idea2.site/web-of-trust/">'
    if flags.draft:
        doc.replace(canonical_old, '<meta name="robots" content="noindex, nofollow">')
    else:
        doc.replace(canonical_old, '<link rel="canonical" href="{{SELF_URL}}">')


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
    with_copy = with_checkbox.replace(
        "Puts you on the waitlist. No accounts, no tracking, one note when the web widens.",
        WAITLIST_COPY,
    ).replace("Join TrustWeb</button>", "Notify me</button>")
    if with_copy.count(WAITLIST_COPY) != 1 or "Notify me</button>" not in with_copy:
        doc.missing.append("joinpanel waitlist copy")
    bottom_join = (
        '<hr class="rule">\n\n'
        "<!-- ================= JOIN, AT THE BOTTOM ================= -->\n"
        '<section class="block joinbottom" id="join">\n'
        '  <div class="sechead">\n'
        '    <p class="chnum">Stay close</p>\n'
        "    <h2>Get a notice when it is stable</h2>\n"
        "  </div>\n" + with_copy + "</section>\n\n"
    )
    sections = (
        fragment(frag_dir, "source-code.html")
        + "\n"
        + fragment(frag_dir, "about-us.html")
    )
    doc.replace("<footer>", sections + "\n" + bottom_join + "<footer>", 1)
    doc.regex(JOIN_SCRIPT_RE, join_script())
    doc.replace("</body>", fragment(frag_dir, "popup-fit.html") + "</body>", 1)
    doc.replace(
        '<h3 style="margin:0 0 6px;font:600 1.1rem var(--sans);color:var(--ink)">Jakob Possert-Bienzle</h3>',
        '<h3 style="margin:0 0 6px;font:600 1.1rem var(--sans);color:var(--ink)">Main Builder: Jakob Possert-Bienzle</h3>',
    )


FAQ_QUESTIONS_RE = re.compile(r'<section id="questions">(.*?)</section>', re.DOTALL)


def faq_section(frag_dir: Path, flags: Flags) -> str:
    """The FAQ as a section of the main page (wave 5). The questions come from the one source,
    pages/faq.body.html, so the section and faq.html cannot drift apart."""
    body = fragment(frag_dir, "pages/faq.body.html")
    found = FAQ_QUESTIONS_RE.search(body)
    if found is None:
        raise SystemExit(
            'pages/faq.body.html: no <section id="questions"> to build the FAQ section from'
        )
    questions = HTML_COMMENT_RE.sub(
        "", resolve_blocks(found.group(1), flags.active_blocks())
    )
    return (
        '<hr class="rule">\n\n'
        "<!-- ================= FAQ ================= -->\n"
        '<section class="block" id="faq">\n'
        '  <div class="sechead">\n'
        '    <p class="chnum">Questions people ask first</p>\n'
        "    <h2>FAQ</h2>\n"
        '    <p class="dek">Answered as TrustWeb works today. Where the honest answer is "not yet", it says so.</p>\n'
        "  </div>\n"
        '  <div class="faqlist">' + questions.strip() + "</div>\n"
        '  <p class="faqall"><a href="faq.html">All questions &rarr;</a></p>\n'
        "</section>\n"
    )


def edit_sections(doc: Doc, frag_dir: Path, flags: Flags) -> None:
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
        + "\n"
        + faq_section(frag_dir, flags)
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
    edit_sections(doc, frag_dir, flags)
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
    shell = resolve_blocks(fragment(frag_dir, "subpage-shell.html"), active)
    css = fragment(frag_dir, "subpage-base.css") + fragment(frag_dir, "chrome.css")
    if not flags.is_org:
        css += fragment(frag_dir, COM_THEME)
    # Author notes in a body fragment (e.g. the imprint's list of gaps) stay in the repo: comments are not served.
    body = HTML_COMMENT_RE.sub(
        "", resolve_blocks(fragment(frag_dir, page.body), active)
    )
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
    return fill_tokens(out, frag_dir, flags)


def pages_for(flags: Flags) -> list[Page]:
    """The pages of the site; terms.html only when it is published (--draft or --publish-terms), on both sites."""
    pages = ORG_PAGES if flags.is_org else COM_PAGES
    return [p for p in pages if p.name != "terms" or flags.terms_visible]


def build_outputs(source: str, frag_dir: Path, flags: Flags) -> dict[str, str]:
    outputs: dict[str, str] = {}
    if flags.is_org:
        index = build_index(source, frag_dir, flags)
        outputs["index.html"] = fill_tokens(index, frag_dir, flags)
    for page in pages_for(flags):
        outputs[f"{page.name}.html"] = build_subpage(page, frag_dir, flags)
    return outputs


def build_all(source: str, frag_dir: Path, out_dir: Path, flags: Flags) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = build_outputs(source, frag_dir, flags)
    for name, text in outputs.items():
        (out_dir / name).write_text(text, encoding="utf-8")
    return list(outputs)


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--src",
        type=Path,
        help="the fetched idea2 web-of-trust index.html (needed for --site org only)",
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
        "--hops-live",
        action="store_true",
        help="describe passing a question on through friends as live (default: not built yet, only direct connections)",
    )
    ap.add_argument(
        "--inperson-live",
        action="store_true",
        help="describe meeting in person with QR scan and code link as live (default: not built yet)",
    )
    ap.add_argument(
        "--inperson-lookup",
        action="store_true",
        help="describe typing code / name / DID as live (default: not built yet)",
    )
    ap.add_argument(
        "--inperson-advanced",
        action="store_true",
        help="describe advanced sharing choices as live (default: not built yet)",
    )
    ap.add_argument(
        "--transcribe-provider",
        default=os.environ.get(
            TRANSCRIBE_PROVIDER_ENV, TranscribeProvider.OPENROUTER.value
        ),
        help="who the copy says transcribes on the server: openrouter (default), berget (Berget, OpenRouter fallback) or "
        f"berget-only; default read from ${TRANSCRIBE_PROVIDER_ENV}",
    )
    ap.add_argument(
        "--publish-terms",
        action="store_true",
        help="publish terms.html outside the draft",
    )
    ap.add_argument(
        "--code-public",
        action="store_true",
        help="include GitHub link in the Is-this-safe FAQ (default: omitted)",
    )
    ap.add_argument(
        "--site",
        choices=[site.value for site in Site],
        default=Site.ORG.value,
        help="org = TrustInTheWeb.org (the website), com = TrustInTheWeb.com (the hosted service)",
    )
    ap.add_argument(
        "--site-host",
        default=IDEA2_HOST,
        help="host the output is served from (default idea2.site, where the org site lives under /trustweb/)",
    )
    ap.add_argument(
        "--app-base",
        default=DEFAULT_APP_BASE,
        help="base URL of the app (default https://app.idea2.site/trustweb; new hosts https://app.trustweb.one, formerly https://app.trustintheweb.org)",
    )
    return ap.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        provider = TranscribeProvider(args.transcribe_provider)
    except ValueError:
        raise SystemExit(
            f"unknown transcribe provider {args.transcribe_provider!r} "
            f"(use {', '.join(p.value for p in TranscribeProvider)})"
        ) from None
    flags = Flags(
        draft=args.draft,
        services_live=args.services_live,
        transcribe_live=args.transcribe_live,
        publish_terms=args.publish_terms,
        site=Site(args.site),
        site_host=args.site_host,
        app_base=args.app_base,
        transcribe_provider=provider,
        hops_live=args.hops_live,
        inperson_live=args.inperson_live,
        inperson_lookup=args.inperson_lookup,
        inperson_advanced=args.inperson_advanced,
        code_public=args.code_public,
    )
    if flags.is_org and args.src is None:
        raise SystemExit("--src is required for --site org")
    source = args.src.read_text(encoding="utf-8") if args.src else ""
    written = build_all(source, args.frag, args.out, flags)
    print("built: " + " ".join(written))
    print(
        f"flags: draft={flags.draft} services_live={flags.services_live} "
        f"transcribe_live={flags.transcribe_live} hops_live={flags.hops_live} inperson_live={flags.inperson_live} "
        f"inperson_lookup={flags.inperson_lookup} inperson_advanced={flags.inperson_advanced} code_public={flags.code_public} terms={flags.terms_visible} "
        f"site={flags.site.value} host={flags.site_host} app={flags.app_base} "
        f"transcribe_provider={flags.transcribe_provider.value}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
