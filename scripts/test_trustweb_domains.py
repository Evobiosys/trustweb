"""Tests of the wave-3 domain helpers: scripts/trustweb_domains_caddy.py and scripts/tw_site_rehost.py.

  python3 -I -m unittest discover -s scripts -p 'test_trustweb_domains.py'
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import trustweb_domains_caddy as caddy
import tw_site_rehost as rehost

# A trimmed Caddyfile with the exact anchors the live file has (2026-10-07).
FIXTURE = (
    "questhub.eco {\n\thandle {\n\t\treverse_proxy localhost:3000\n\t}\n}\n\n"
    "idea2.site, www.idea2.site {\n"
    "\t@trustweb_demos path /trustweb/demo /trustweb/demo/*\n"
    "\tredir @trustweb_demos https://app.idea2.site{uri} temporary\n"
    + caddy.IDEA2_OLD_SERVE
    + "\t@trustweb_alias path /tw /tw/ /tw/* /trust-web /trust-web/ /trust-web/*\n"
    + caddy.IDEA2_OLD_ALIAS
    + "\thandle {\n\t\troot * /srv/questhub-static/idea2-site\n\t\tfile_server\n\t}\n}\n\n"
    "evobiosys.org, www.evobiosys.org {\n\troot * /srv/questhub-static/evobiosys-org\n\troute {\n"
    + caddy.EVOBIOSYS_ANCHOR
    + "\t\tredir /pitch /pitch/ 301\n\t\tfile_server\n\t}\n}\n"
)


class CaddyTransforms(unittest.TestCase):
    def test_all_transforms_apply_once_and_are_idempotent(self) -> None:
        names = list(caddy.Transform)
        once = caddy.apply(FIXTURE, names)
        self.assertNotEqual(once, FIXTURE)
        self.assertEqual(caddy.apply(once, names), once)
        for host in ("trustintheweb.org {", "app.trustintheweb.org {", "trustintheweb.com {", "trustweb.one, www.trustweb.one {"):
            self.assertEqual(once.count("\n" + host + "\n"), 1, host)

    def test_app_block_keeps_microphone_and_proxies_every_service_route(self) -> None:
        text = caddy.apply(FIXTURE, [caddy.Transform.SITES])
        start = text.index("\napp.trustintheweb.org {\n")
        block = text[start:]
        self.assertIn('microphone=(self)', block)
        self.assertNotIn('microphone=()', block)
        for route in ("handle /backup/*", "handle /hosted/*", "handle /transcribe", "handle /feedback", "handle /relay/*"):
            self.assertIn(route, block)
        self.assertIn("root * /srv/questhub-static/app-trustintheweb", block)

    def test_static_sites_switch_powerful_features_off(self) -> None:
        text = caddy.apply(FIXTURE, [caddy.Transform.SITES])
        self.assertIn('Permissions-Policy "camera=(), microphone=(), geolocation=()"', text)

    def test_sites_refuse_an_unmarked_existing_block(self) -> None:
        with self.assertRaises(caddy.TransformError):
            caddy.add_sites(FIXTURE + "\ntrustintheweb.org {\n\tfile_server\n}\n")

    def test_idea2_redirect_keeps_the_draft_and_preserves_the_path(self) -> None:
        text = caddy.idea2_redirect(FIXTURE)
        self.assertIn("redir https://trustintheweb.org{uri} permanent", text)
        self.assertIn("@trustweb_draft path /draft/*", text)
        self.assertNotIn("redir https://idea2.site/trustweb/ temporary", text)
        self.assertIn("redir https://trustintheweb.org/ permanent", text)
        # the demo-context redirect to the app is untouched
        self.assertIn("redir @trustweb_demos https://app.idea2.site{uri} temporary", text)

    def test_idea2_redirect_upgrades_the_first_version_once(self) -> None:
        v2 = caddy.idea2_redirect(FIXTURE)
        v1 = v2.replace(caddy.IDEA2_DRAFT_V2, caddy.IDEA2_DRAFT_V1)
        self.assertNotEqual(v1, v2)
        self.assertEqual(caddy.idea2_redirect(v1), v2)
        self.assertEqual(caddy.idea2_redirect(v2), v2)
        self.assertNotIn("handle_path /trustweb/draft/*", v2)

    def test_idea2_redirect_fails_without_its_anchor(self) -> None:
        with self.assertRaises(caddy.TransformError):
            caddy.idea2_redirect(FIXTURE.replace(caddy.IDEA2_OLD_SERVE, ""))

    def test_evobiosys_redirect_lands_inside_the_route_before_pitch(self) -> None:
        text = caddy.evobiosys_redirect(FIXTURE)
        self.assertLess(text.index("@trustintheweb_alias path /tw /tw/ /tw/* /trustweb /trustweb/ /trustweb/*"), text.index("redir /pitch /pitch/ 301"))
        self.assertIn("redir @trustintheweb_alias https://evobiosys.org/trustintheweb/ permanent", text)

    def test_evobiosys_redirect_fails_outside_its_block(self) -> None:
        with self.assertRaises(caddy.TransformError):
            caddy.evobiosys_redirect(FIXTURE.replace("evobiosys.org, www.evobiosys.org {", "evobiosys.org {"))


PAGE = (
    "<title>TrustWeb · idea2.site</title>\n"
    '<link rel="canonical" href="https://idea2.site/trustweb/">\n'
    '<p class="eyebrow"><span class="dot"></span> idea2.site</p>\n'
    '<a href="https://app.idea2.site/trustweb/?install=1">Install</a>\n'
    '<a href="https://app.idea2.site/trustweb/demo/">Demo</a>\n'
    '<form data-endpoint="https://app.idea2.site/feedback"></form>\n'
    '<a href="https://app.idea2.site/wot/demo/">older demos</a>\n'
)


class Rehost(unittest.TestCase):
    def test_rewrites_app_feedback_site_and_label(self) -> None:
        out = rehost.rehost_text(PAGE, "trustintheweb.org", "https://app.trustintheweb.org")
        self.assertIn("<title>TrustWeb · TrustInTheWeb.org</title>", out)
        self.assertIn('href="https://trustintheweb.org/"', out)
        self.assertIn("https://app.trustintheweb.org/?install=1", out)
        self.assertIn("https://app.trustintheweb.org/demo/", out)
        self.assertIn('"https://app.trustintheweb.org/feedback"', out)
        self.assertIn('<span class="dot"></span> TrustInTheWeb.org</p>', out)
        self.assertIn("https://app.idea2.site/wot/demo/", out)  # older demos stay where they are
        self.assertIsNone(rehost.LEFTOVER.search(out))

    def test_dir_is_all_or_nothing_on_a_leftover(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            good, bad = Path(d, "a.html"), Path(d, "b.html")
            good.write_text(PAGE, encoding="utf-8")
            bad.write_text('<a href="http://www.idea2.site/tw/">old alias</a>', encoding="utf-8")
            with self.assertRaises(rehost.RehostError):
                rehost.rehost_dir(Path(d), "trustintheweb.org", "https://app.trustintheweb.org")
            self.assertEqual(good.read_text(encoding="utf-8"), PAGE)

    def test_dir_rewrite_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            Path(d, "index.html").write_text(PAGE, encoding="utf-8")
            self.assertEqual(rehost.rehost_dir(Path(d), "trustintheweb.org", "https://app.trustintheweb.org"), ["index.html"])
            self.assertEqual(rehost.rehost_dir(Path(d), "trustintheweb.org", "https://app.trustintheweb.org"), [])

    def test_bad_arguments_are_refused(self) -> None:
        for host, origin in (("trustintheweb.org/x", "https://app.trustintheweb.org"), ("trustintheweb.org", "http://app.trustintheweb.org"),
                             ("trustintheweb.org", "https://app.trustintheweb.org/"), ("", "https://app.trustintheweb.org")):
            with self.assertRaises(rehost.RehostError, msg=f"{host} {origin}"):
                rehost.check_args(host, origin)

    def test_site_label(self) -> None:
        self.assertEqual(rehost.site_label("trustintheweb.org"), "TrustInTheWeb.org")
        self.assertEqual(rehost.site_label("trustintheweb.com"), "TrustInTheWeb.com")
        self.assertEqual(rehost.site_label("example.org"), "example.org")


if __name__ == "__main__":
    unittest.main()
