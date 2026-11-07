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

    def test_roles(self) -> None:
        one = (self.tmp / "trustweb-one" / "index.html").read_text(encoding="utf-8")
        for needle in ('href="https://app.trustweb.one/"', 'href="https://app.trustweb.one/?install=1"', 'href="https://app.trustweb.one/demo/"'):
            self.assertIn(needle, one)
        com = (self.tmp / "trustintheweb-com" / "index.html").read_text(encoding="utf-8")
        self.assertIn("run it yourself", com.lower())
        self.assertIn("https://trustintheweb.org/#source-code", com)
        self.assertTrue((self.tmp / "trustintheweb-com" / "pricing.html").is_file())
        org = (self.tmp / "trustintheweb-org" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="phases"', org)
        self.assertIn('id="source-code"', org)

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
