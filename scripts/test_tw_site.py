"""Tests of the wave-4 and wave-5 site changes in scripts/tw-front-door/tw_site.py (the subpages need no source page).

python3 -I -m unittest discover -s scripts -p 'test_tw_site.py'
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

FRAG = Path(__file__).resolve().parent / "tw-front-door"
sys.path.insert(0, str(FRAG))

import tw_site as site

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
            self.assertEqual(len(sections), 16)
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
        self.assertEqual(section.count('<details class="q"'), 12)  # wave 6e added q-is-this-safe
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


if __name__ == "__main__":
    unittest.main()
