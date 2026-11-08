"""Tests of the wave-4 and wave-5 site changes in scripts/tw-front-door/tw_site.py (the subpages need no source page).

python3 -I -m unittest discover -s scripts -p 'test_tw_site.py'
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FRAG = Path(__file__).resolve().parent / "tw-front-door"
SITES = Path(__file__).resolve().parent / "tw-sites"
sys.path.insert(0, str(FRAG))
sys.path.insert(0, str(SITES))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_sites
import tw_site as site
import tw_site_rehost

OLD_PHRASES = re.compile(
    r"the app and (its |the )?web ?site|app and website", re.IGNORECASE
)
BINDING = "you agree not to scrape, store, cache or redistribute the results"


def flags(
    which: site.Site, *, draft: bool = False, publish_terms: bool = False
) -> site.Flags:
    host = site.ORG_HOST if which is site.Site.ORG else site.COM_HOST
    return site.Flags(
        draft=draft,
        services_live=True,
        transcribe_live=False,
        publish_terms=publish_terms,
        site=which,
        site_host=host,
        app_base="https://app.trustintheweb.org",
    )


def pages(
    which: site.Site, *, draft: bool = False, publish_terms: bool = False
) -> dict[str, str]:
    """Every subpage of the site (the org front page needs the fetched source and is checked by verify_site.mjs)."""
    f = flags(which, draft=draft, publish_terms=publish_terms)
    return {f"{p.name}.html": site.build_subpage(p, FRAG, f) for p in site.pages_for(f)}


class Subpages(unittest.TestCase):
    def test_both_production_privacy_pages_carry_the_web_results_lines(self) -> None:
        for which in site.Site:
            text = re.sub(r"\s+", " ", pages(which)["privacy.html"])
            with self.subTest(site=which.value):
                self.assertIn('id="web-results"', text)
                self.assertIn(BINDING, text)
                self.assertIn("Powered by Brave", text)
                self.assertIn("without your network address", text)
                self.assertIn("Brave may log them under its own terms", text)
                self.assertIn("keeps no copy of your words or of the results", text)

    def test_privacy_states_the_apple_push_caveat_on_both_sites(self) -> None:
        for which in site.Site:
            text = re.sub(r"\s+", " ", pages(which)["privacy.html"])
            with self.subTest(site=which.value):
                self.assertIn('id="notifications"', text)
                self.assertIn("Apple makes it mandatory", text)
                self.assertIn("Apple sees that something arrived for your device and when, never what", text)
                self.assertIn("Something arrived for you", text)
                self.assertIn("Apple</b>, in the United States", text)
                self.assertIn('id="d-notifications"', pages(which)["data-policy.html"])

    def test_terms_are_built_only_when_published_and_then_on_both_sites(self) -> None:
        for which in site.Site:
            with self.subTest(site=which.value):
                self.assertNotIn("terms.html", pages(which))
                for kwargs in ({"draft": True}, {"publish_terms": True}):
                    built = pages(which, **kwargs)
                    self.assertIn(BINDING, re.sub(r"\s+", " ", built["terms.html"]))
                    self.assertIn("AGPL-3.0-or-later", built["terms.html"])
                    self.assertNotIn("not in force", built["terms.html"])

    def test_every_legal_page_opens_with_the_ai_banner_on_both_sites(self) -> None:
        legal = ("privacy.html", "data-policy.html", "terms.html", "imprint.html")
        for which in site.Site:
            built = pages(which, publish_terms=True)
            for name in legal:
                with self.subTest(site=which.value, page=name):
                    self.assertIn(name, built)
                    body = built[name].split('<main id="main"', 1)[1]
                    self.assertLess(
                        body.index("AI drafted, subject to review."), body.index("<h1")
                    )
            self.assertNotIn(
                '<aside class="banner ai-draft"', built.get("feedback.html", "")
            )

    def test_legal_footer_links_follow_the_publishing_flag(self) -> None:
        for which in site.Site:
            footer = pages(which, publish_terms=True)["privacy.html"].split(
                'class="sitefooter"', 1
            )[1]
            self.assertLess(
                footer.index('href="privacy.html">Privacy'),
                footer.index('href="data-policy.html"'),
            )
            self.assertIn('href="terms.html">Terms</a>', footer)
            self.assertNotIn(
                'href="terms.html">Terms</a>', pages(which)["privacy.html"]
            )

    def test_the_data_policy_answers_five_questions_per_data_kind(self) -> None:
        for which in site.Site:
            html = pages(which)["data-policy.html"]
            sections = re.findall(
                r'<section id="(d-[a-z-]+)">(.*?)</section>', html, re.DOTALL
            )
            self.assertEqual(len(sections), 17)
            for ident, body in sections:
                with self.subTest(site=which.value, section=ident):
                    self.assertEqual(
                        re.findall(r"<dt>(.*?)</dt>", body),
                        [
                            "What",
                            "Where",
                            "How long",
                            "Who can read it",
                            "How to delete it",
                        ],
                    )

    def test_no_legal_page_claims_anonymous_counters_or_an_invented_address(
        self,
    ) -> None:
        for which in site.Site:
            for name, html in pages(which, publish_terms=True).items():
                with self.subTest(site=which.value, page=name):
                    self.assertIsNone(
                        re.search(
                            r"anonymous (in-memory )?counters", html, re.IGNORECASE
                        )
                    )
        imprint = pages(site.Site.ORG)["imprint.html"]
        self.assertGreaterEqual(imprint.count("[to be completed by the owner]"), 6)
        self.assertIsNone(re.search(r"\b\d{4}\s+Wien\b|ATU\s?\d{8}", imprint))

    def test_the_faq_section_comes_from_the_one_faq_fragment(self) -> None:
        f = flags(site.Site.ORG)
        section = site.faq_section(FRAG, f)
        self.assertEqual(section.count('<details class="q"'), 13)  # 12 + q-is-this-safe + the reach-out entry (b30f47f72)
        self.assertIn('<a href="faq.html">All questions', section)
        self.assertNotIn("<!--", section.replace("<!-- ===", "").replace("=== -->", ""))

    def test_the_waitlist_copy_is_exactly_what_jakob_dictated(self) -> None:
        self.assertEqual(
            site.WAITLIST_COPY,
            "You can use it right now. If you want to be notified once it is stable, leave your email here.",
        )

    def test_com_fetches_no_fonts_and_says_so_on_privacy(self) -> None:
        com = pages(site.Site.COM)
        for name, html in com.items():
            with self.subTest(page=name):
                self.assertNotIn("fonts.googleapis", html)
                self.assertNotIn("fonts.gstatic", html)
                self.assertIn('data-site="com"', html)
        self.assertIn("Typefaces come from your own device", com["privacy.html"])
        self.assertNotIn("Google Fonts", com["privacy.html"])

    def test_org_keeps_google_fonts_and_names_them(self) -> None:
        org = pages(site.Site.ORG)
        self.assertIn("fonts.googleapis.com", org["why.html"])
        self.assertIn("Typefaces load from Google Fonts", org["privacy.html"])
        self.assertNotIn("com/theme", org["why.html"])
        self.assertNotIn('data-site="com"', org["why.html"])

    def test_inspect_page_is_built_linked_and_marked_as_ai_formulation(self) -> None:
        org = pages(site.Site.ORG)
        self.assertIn("Inspect us", org["inspect.html"])
        self.assertIn("AI formulation of Jakob", org["inspect.html"])
        self.assertIn('href="inspect.html"', org["why.html"])

    def test_com_carries_its_own_theme_and_org_does_not(self) -> None:
        self.assertIn(':root[data-site="com"]', pages(site.Site.COM)["pricing.html"])
        self.assertNotIn(':root[data-site="com"]', pages(site.Site.ORG)["why.html"])

    def test_both_footers_say_with_love_from_vienna(self) -> None:
        for which in site.Site:
            for name, html in pages(which).items():
                with self.subTest(site=which.value, page=name):
                    self.assertEqual(html.count("with love from Vienna"), 1)

    def test_no_hero_site_label_and_no_old_phrase_anywhere(self) -> None:
        for which in site.Site:
            for name, html in pages(which, draft=True).items():
                with self.subTest(site=which.value, page=name):
                    self.assertIsNone(OLD_PHRASES.search(html))
                    self.assertNotIn('<span class="dot"></span>', html)
        com = pages(site.Site.COM)["privacy.html"]
        self.assertIn("About the infrastructure", com)
        self.assertNotIn(
            '<p class="eyebrow">TrustInTheWeb.com</p>',
            pages(site.Site.COM)["pricing.html"],
        )

    def test_the_fragments_never_name_the_old_phrase(self) -> None:
        for path in FRAG.rglob("*.html"):
            with self.subTest(fragment=path.name):
                self.assertIsNone(OLD_PHRASES.search(path.read_text(encoding="utf-8")))

    def test_org_links_to_hosting_once_and_com_links_back_in_header_and_footer(
        self,
    ) -> None:
        org = pages(site.Site.ORG)["why.html"]
        self.assertEqual(
            org.count("Do you need hosting?"), 2
        )  # header and footer: the only hosting mention
        self.assertEqual(
            re.findall(r'href="[^"]*pricing[^"]*"', org.replace("kind=pricing", "")), []
        )
        com = pages(site.Site.COM)["pricing.html"]
        self.assertIn('class="hostlink" href="https://trustintheweb.org/"', com)
        self.assertGreaterEqual(
            com.count('href="https://trustintheweb.org/"'), 2
        )  # header and footer


class InPersonFlags(unittest.TestCase):
    """Wave 6b (review): inperson-lookup and inperson-advanced describe parts of the live flow, so alone they turn nothing on."""

    def blocks(self, live: bool, lookup: bool, advanced: bool) -> frozenset[str]:
        base = flags(site.Site.ORG)
        return site.Flags(**{**base.__dict__, "inperson_live": live, "inperson_lookup": lookup, "inperson_advanced": advanced}).active_blocks()

    def test_sub_flags_alone_render_nothing(self) -> None:
        active = self.blocks(False, True, True)
        self.assertIn("inperson-off", active)
        self.assertIn("inperson-lookup-off", active)
        self.assertIn("inperson-advanced-off", active)

    def test_sub_flags_with_live_turn_their_part_on(self) -> None:
        active = self.blocks(True, True, True)
        self.assertTrue({"inperson-on", "inperson-lookup-on", "inperson-advanced-on"} <= active)
        self.assertIn("inperson-lookup-off", self.blocks(True, False, True))

    def test_every_inperson_block_name_in_the_sources_is_one_the_flags_can_turn_on(self) -> None:
        names = {"inperson-on", "inperson-off", "inperson-lookup-on", "inperson-lookup-off", "inperson-advanced-on", "inperson-advanced-off"}
        for path in (FRAG / "how-it-works.html", FRAG / "pages" / "faq.body.html"):
            used = set(re.findall(r"<!--IF:(inperson[\w-]*)-->", path.read_text()))
            self.assertTrue(used <= names, (path.name, used - names))


LINK_RE = re.compile(r'(?:href|src)="([^"]*)"')
SCRIPT_RE = re.compile(r"<script.*?</script>", re.DOTALL)
SITE_DIRS = ("trustintheweb-org", "trustintheweb-com", "trustweb-one")


class ThreeSites(unittest.TestCase):
    """Wave 36 sites-three: one generator, three static sites (scripts/tw-sites/build_sites.py)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp(prefix="tw-sites-test."))
        build_sites.build_all(cls.tmp)

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.tmp, ignore_errors=True)  # scratch under /tmp only

    def pages(self):
        for d in SITE_DIRS:
            for p in sorted((self.tmp / d).glob("*.html")):
                yield d, p, p.read_text(encoding="utf-8")

    def test_each_site_has_a_front_page_brand_and_manifest(self) -> None:
        for d in SITE_DIRS:
            for name in ("index.html", "favicon.svg", "site.css", "site.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"):
                with self.subTest(site=d, file=name):
                    self.assertTrue((self.tmp / d / name).is_file())

    def test_every_page_has_the_wordmark_theme_boot_and_no_external_asset(self) -> None:
        for d, p, html in self.pages():
            with self.subTest(site=d, page=p.name):
                self.assertIn('class="wordmark"', html)
                self.assertIn("tw-theme", html)
                self.assertIn('data-site="', html)
                self.assertNotIn("fonts.googleapis", html)
                self.assertNotIn("fonts.gstatic", html)
                self.assertIsNone(re.search(r'<(?:link|script|img)[^>]+(?:href|src)="https?://', html))

    def test_relative_links_and_anchors_resolve_inside_the_out_dir(self) -> None:
        for d, p, html in self.pages():
            for href in LINK_RE.findall(SCRIPT_RE.sub("", html)):
                if re.match(r"(?:[a-z][a-z0-9+.-]*:|//)", href) or href == "":
                    continue
                path, _, frag = href.partition("#")
                path = path.partition("?")[0] or p.name
                target = self.tmp / d / (path if path != "./" else "index.html")
                if path.endswith("/"):
                    target = self.tmp / d / path / "index.html"
                with self.subTest(site=d, page=p.name, href=href):
                    self.assertTrue(target.is_file())
                    if frag and target.suffix == ".html":
                        self.assertIn(f'id="{frag}"', target.read_text(encoding="utf-8"))

    def test_the_old_idea2_homes_are_gone_from_all_three(self) -> None:
        for d in SITE_DIRS:
            for page in (self.tmp / d).glob("*.html"):
                with self.subTest(site=d, page=page.name):
                    self.assertIsNone(tw_site_rehost.LEFTOVER.search(page.read_text(encoding="utf-8")))
        host = {"trustintheweb-org": "trustintheweb.org", "trustintheweb-com": "trustintheweb.com", "trustweb-one": "trustweb.one"}
        for d, h in host.items():
            tw_site_rehost.rehost_dir(self.tmp / d, h, "https://app.trustweb.one")

    def test_each_footer_links_the_other_two_sites(self) -> None:
        urls = {"trustintheweb-org": "https://trustintheweb.org/", "trustintheweb-com": "https://trustintheweb.com/", "trustweb-one": "https://trustweb.one/"}
        for d, p, html in self.pages():
            footer = html.split('class="sitefooter"', 1)[1]
            for other, url in urls.items():
                with self.subTest(site=d, page=p.name, other=other):
                    if other != d:
                        self.assertIn(f'href="{url}"', footer)
            self.assertEqual(html.count("with love from Vienna"), 1)

    def page(self, d: str, name: str = "index.html") -> str:
        return (self.tmp / d / name).read_text(encoding="utf-8")

    def test_no_site_has_the_lineage_the_ea_pilot_or_the_words_sister_sites(self) -> None:
        for d, p, html in self.pages():
            with self.subTest(site=d, page=p.name):
                self.assertNotIn('id="lineage"', html)
                low = html.lower()
                for banned in ("sister site", "ea groups", "april 2027", "ea-groups"):
                    self.assertNotIn(banned, low)

    def test_org_is_only_the_organisation(self) -> None:
        org = self.page("trustintheweb-org")
        self.assertIn('class="orgmark"', org)
        self.assertLess(org.index('class="orgmark"'), org.index("<h1"))
        for hid in ("stewardship", "governance", "source-code", "team", "contact"):
            self.assertIn(f'id="{hid}"', org)
        for gone in ("features", "use-cases", "how-it-works", "phases", "ecosystem", "ea-groups", "name"):
            self.assertNotIn(f'id="{gone}"', org)
        self.assertIn(">The app: trustweb.one</a>", org)
        self.assertNotIn("Try the demo", org)
        self.assertIn("AGPL", org)
        self.assertIn("mailto:connect@evobiosys.org", org)
        self.assertEqual(sorted(p.name for p in (self.tmp / "trustintheweb-org").glob("*.html")),
                         ["data-policy.html", "feedback.html", "imprint.html", "index.html", "privacy.html"])

    def test_com_is_only_subscription_and_hosting(self) -> None:
        com = self.page("trustintheweb-com")
        for needle in ("Small", "5 € per month", "Big", "18 € per month", "Enterprise", "mailto:connect@evobiosys.org", "Ask your web"):
            self.assertIn(needle, com)
        self.assertIn("starting soon", com.lower())
        for hid in ("hosting", "plans", "sync", "privacy-summary", "contact"):
            self.assertIn(f'id="{hid}"', com)
        self.assertIn('href="https://trustweb.one/"', com)
        self.assertIn('href="https://trustintheweb.org/"', com)
        self.assertNotIn("Run it yourself", com)
        self.assertNotIn("pilot", com.lower())

    def test_one_is_the_app_home_with_open_hosted_and_self_hosted(self) -> None:
        one = self.page("trustweb-one")
        self.assertIn("<h1>Find people and things through people you trust.</h1>", one)
        self.assertIn("TrustWeb lets you ask the people you have met, and the people they trust, without posting to a crowd. A question travels, the data stays on each phone.", one)
        for title in ("More scalable", "More discreet", "More targeted"):
            self.assertIn(f"<h3>{title}</h3>", one)
        for hid in ("use-cases", "features", "hosting", "self-host", "stewards"):
            self.assertIn(f'id="{hid}"', one)
        uc = one.split('id="use-cases"', 1)[1].split("</section>", 1)[0]
        self.assertEqual(uc.count('class="ucard"'), 3)
        for dropped in ("Ask for support", "Cohort feed"):
            self.assertNotIn(dropped, one)
        script = one.split('id="self-host"', 1)[1].split("</pre>", 1)[0]
        for line in ("git clone ", "pnpm install", "vite build", "serve dist"):
            self.assertIn(line, script)
        self.assertNotIn("| sh", one)
        self.assertRegex(one, r'<a class="[^"]*nav-open[^"]*" href="https://app\.trustweb\.one/">Open</a>')
        self.assertNotIn("Sign up", one)
        self.assertRegex(one, r'Want to know who stewards the code\? <a href="https://trustintheweb\.org/">TrustInTheWeb\.org</a>')
        for hid in ("f-web", "f-ask", "f-record", "f-inventory", "name"):
            self.assertIn(f'id="{hid}"', one)
        self.assertTrue((self.tmp / "trustweb-one" / "why.html").is_file())

    def test_review_org_and_com_footers_carry_no_app_demo_or_install(self) -> None:
        for d in ("trustintheweb-org", "trustintheweb-com"):
            for p in (self.tmp / d).glob("*.html"):
                footer = p.read_text(encoding="utf-8").split('class="sitefooter"', 1)[1]
                with self.subTest(site=d, page=p.name):
                    self.assertNotIn("app.trustweb.one/demo/", footer)
                    self.assertNotIn("?install=1", footer)
                    self.assertIn('href="https://trustweb.one/"', footer)

    def test_review_one_hero_has_the_demo_cta_and_the_script_builds_like_ci(self) -> None:
        one = self.page("trustweb-one")
        hero = one.split('class="hero"', 1)[1].split("</header>", 1)[0]
        self.assertIn('href="https://app.trustweb.one/demo/">See TrustWeb in action</a>', hero)
        card = one.split('id="self-host"', 1)[1].split("</div>", 1)[0]
        self.assertIn("../crm/node_modules/.bin/vite build", card)  # .github/workflows/ci.yml builds with apps/crm's Vite 8
        self.assertNotIn("../demo/node_modules/.bin/vite", card)
        self.assertIn("mailto:connect@evobiosys.org", card)  # the public copy does not hold apps/trustweb yet

    def test_review_one_open_button_sits_top_right_outside_the_wrapping_nav(self) -> None:
        topbar = self.page("trustweb-one").split('class="topbar"', 1)[1].split("</div></div>", 1)[0]
        self.assertIn('</nav><a class="nav-open" href="https://app.trustweb.one/">Open</a>', topbar)
        css = (self.tmp / "trustweb-one" / "site.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"@media \(max-width:\s*\d+px\)\{[^}]*\.nav-open\{[^}]*order:1")

    def test_review_sync_is_never_claimed_as_live(self) -> None:
        for d in ("trustweb-one", "trustintheweb-com"):
            for para in re.findall(r"<p[ >].*?</p>", self.page(d), re.DOTALL):
                if "sync" in para.lower():
                    with self.subTest(site=d, para=para[:80]):
                        self.assertIn("soon", para.lower())

    def test_roles(self) -> None:
        one = self.page("trustweb-one")
        for needle in ('href="https://app.trustweb.one/"', 'href="https://app.trustweb.one/demo/"'):
            self.assertIn(needle, one)
        self.assertTrue((self.tmp / "trustintheweb-com" / "pricing.html").is_file())
        self.assertIn("Small", self.page("trustintheweb-com", "pricing.html"))

    def test_css_has_theme_motion_and_underlined_links(self) -> None:
        css = (self.tmp / "trustweb-one" / "site.css").read_text(encoding="utf-8")
        self.assertIn("prefers-color-scheme", css)
        self.assertIn('[data-motion="off"]', css)
        self.assertRegex(css, r"a\{[^}]*text-decoration:underline")
        self.assertIn('[data-site="org"]', (self.tmp / "trustintheweb-org" / "site.css").read_text(encoding="utf-8"))
        self.assertIn('[data-site="com"]', (self.tmp / "trustintheweb-com" / "site.css").read_text(encoding="utf-8"))

    def test_deploy_script_prints_in_dry_mode_and_refuses_without_approval(self) -> None:
        script = str(SITES / "deploy_sites.sh")
        dry = subprocess.run([script, "--dry"], capture_output=True, text=True)
        self.assertEqual(dry.returncode, 0, dry.stderr)
        self.assertIn("questhub:/srv/questhub-static/trustweb-one", dry.stdout)
        self.assertNotIn("--delete", dry.stdout)
        refused = subprocess.run([script], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin", "HOME": str(Path.home())})
        self.assertEqual(refused.returncode, 3)

    def test_screens_have_no_horizontal_scroll_at_360_and_1280(self) -> None:
        node = shutil.which("node")
        script = SITES / "check_screens.mjs"
        if not node:
            self.skipTest("node missing")
        shots = Path(tempfile.mkdtemp(prefix="tw-sites-shots."))
        done = subprocess.run([node, str(script), str(self.tmp), str(shots)], capture_output=True, text=True)
        if done.returncode == 3:
            self.skipTest("playwright or chromium missing: " + done.stderr.strip()[:200])
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)


if __name__ == "__main__":
    unittest.main()
