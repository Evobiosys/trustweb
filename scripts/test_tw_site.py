"""Tests of the wave-4 site changes in scripts/tw-front-door/tw_site.py (the subpages need no source page).

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


def flags(which: site.Site, *, draft: bool = False) -> site.Flags:
    host = site.ORG_HOST if which is site.Site.ORG else site.COM_HOST
    return site.Flags(
        draft=draft,
        services_live=True,
        transcribe_live=False,
        publish_terms=False,
        site=which,
        site_host=host,
        app_base="https://app.trustintheweb.org",
    )


def pages(which: site.Site, *, draft: bool = False) -> dict[str, str]:
    """Every subpage of the site (the org front page needs the fetched source and is checked by verify_site.mjs)."""
    f = flags(which, draft=draft)
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

    def test_terms_exist_only_in_the_org_draft_and_carry_the_binding_line(self) -> None:
        self.assertNotIn("terms.html", pages(site.Site.ORG))
        self.assertNotIn("terms.html", pages(site.Site.COM, draft=True))
        terms = re.sub(r"\s+", " ", pages(site.Site.ORG, draft=True)["terms.html"])
        self.assertIn(BINDING, terms)

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


if __name__ == "__main__":
    unittest.main()
