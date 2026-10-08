"""Tests of the wave-3 domain helpers: scripts/trustweb_domains_caddy.py and scripts/tw_site_rehost.py.

  python3 -I -m unittest discover -s scripts -p 'test_trustweb_domains.py'
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit

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

    def test_app_idea2_site_is_never_redirected_or_changed(self) -> None:
        """Storage is per origin: the live app host (where existing phones keep their data) must stay as it is."""
        app_block = (
            "app.idea2.site {\n\thandle /backup/* {\n\t\treverse_proxy 127.0.0.1:8960\n\t}\n"
            "\thandle_path /trustweb/* {\n\t\troot * /srv/questhub-static/app-idea2-trustweb\n\t\tfile_server\n\t}\n}\n"
        )
        fixture = FIXTURE.replace("evobiosys.org, www.evobiosys.org {", app_block + "\nevobiosys.org, www.evobiosys.org {")
        out = caddy.apply(fixture, list(caddy.Transform))
        start = out.index("\napp.idea2.site {\n")
        end = out.index("\n}\n", start) + 3
        self.assertEqual(out[start + 1:end], app_block)
        self.assertEqual(out.count("app.idea2.site {"), 1)
        # no transform emits a redirect whose source is the app host
        self.assertNotIn("redir https://app.trustintheweb.org", out)

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
    '<a href="https://app.idea2.site/trustweb/?install=1">Install</a>\n'
    '<a href="https://app.idea2.site/trustweb/demo/">Demo</a>\n'
    '<form data-endpoint="https://app.idea2.site/feedback"></form>\n'
    '<a href="https://app.idea2.site/wot/demo/">older demos</a>\n'
)


class Rehost(unittest.TestCase):
    def test_rewrites_app_feedback_site_and_title_label(self) -> None:
        out = rehost.rehost_text(PAGE, "trustintheweb.org", "https://app.trustintheweb.org")
        self.assertIn("<title>TrustWeb · TrustInTheWeb.org</title>", out)
        self.assertIn('href="https://trustintheweb.org/"', out)
        self.assertIn("https://app.trustintheweb.org/?install=1", out)
        self.assertIn("https://app.trustintheweb.org/demo/", out)
        self.assertIn('"https://app.trustintheweb.org/feedback"', out)
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


# The live app.trustintheweb.org block carries routes the SITES_BLOCK constant predates (wave 4 and 5); the clone must copy them.
LIVE_EXTRA_ROUTES = (
    "\t# --- TrustWeb web results (wave 4) ---\n"
    "\thandle /websearch* {\n\t\t@ws_query expression {http.request.uri.query} != ''\n\t\trespond @ws_query 400\n\t\treverse_proxy 127.0.0.1:8960\n\t}\n"
    "\thandle /link {\n\t\tlog_skip\n\t\treverse_proxy 127.0.0.1:8960\n\t}\n"
    "\thandle /l/* {\n\t\tlog_skip\n\t\treverse_proxy 127.0.0.1:8960\n\t}\n"
)
RELAY_ANCHOR = "\t# The one relay process: a phone on app.idea2.site"


def live_like_fixture() -> str:
    text = caddy.apply(FIXTURE, [caddy.Transform.SITES])
    assert text.count(RELAY_ANCHOR) == 1
    return text.replace(RELAY_ANCHOR, LIVE_EXTRA_ROUTES + RELAY_ANCHOR)


def block_of(text: str, head: str) -> str:
    start = text.index("\n" + head + "\n") + 1
    return text[start:text.index("\n}\n", start) + 3]


class AppTrustwebOne(unittest.TestCase):
    """Wave 6c: app.trustweb.one is the app.trustintheweb.org block, host and root changed, nothing else."""

    def test_block_copies_every_live_route_and_changes_only_host_and_root(self) -> None:
        live = live_like_fixture()
        out = caddy.apply(live, [caddy.Transform.APP_TRUSTWEB_ONE])
        one = block_of(out, "app.trustweb.one {")
        for route in ("handle /websearch*", "handle /link", "handle /l/*", "handle /relay/*", "handle /backup/*", "handle /feedback"):
            self.assertIn(route, one)
        self.assertIn("{http.request.uri.query} != ''", one)
        self.assertIn("root * /srv/questhub-static/app-trustweb-one\n", one)
        self.assertNotIn("app-trustintheweb", one)
        self.assertIn("TW_APP_TARGET=trustweb-one", one)
        self.assertIn('Permissions-Policy "camera=(self), microphone=(self), geolocation=()"', one)
        self.assertEqual(caddy.app_block_parity(out), [])
        # the source block and everything before it are untouched
        self.assertEqual(block_of(out, "app.trustintheweb.org {"), block_of(live, "app.trustintheweb.org {"))
        self.assertTrue(out.startswith(live.rstrip("\n")))

    def test_second_run_is_a_no_op(self) -> None:
        once = caddy.apply(live_like_fixture(), [caddy.Transform.APP_TRUSTWEB_ONE])
        self.assertEqual(caddy.apply(once, [caddy.Transform.APP_TRUSTWEB_ONE]), once)

    def test_a_later_route_on_the_org_block_shows_as_drift_and_a_rerun_syncs_it(self) -> None:
        once = caddy.apply(live_like_fixture(), [caddy.Transform.APP_TRUSTWEB_ONE])
        later = once.replace(RELAY_ANCHOR, "\thandle /connect {\n\t\tlog_skip\n\t\treverse_proxy 127.0.0.1:8960\n\t}\n" + RELAY_ANCHOR, 1)
        drift = caddy.app_block_parity(later)
        self.assertTrue(any(line.startswith("-") and "handle /connect" in line for line in drift), drift)
        synced = caddy.apply(later, [caddy.Transform.APP_TRUSTWEB_ONE])
        self.assertEqual(caddy.app_block_parity(synced), [])
        self.assertIn("handle /connect", block_of(synced, "app.trustweb.one {"))
        self.assertEqual(synced.count("\napp.trustweb.one {\n"), 1)

    def test_refuses_without_the_source_block_or_with_a_foreign_block(self) -> None:
        with self.assertRaises(caddy.TransformError):
            caddy.apply(FIXTURE, [caddy.Transform.APP_TRUSTWEB_ONE])
        with self.assertRaises(caddy.TransformError):
            caddy.apply(live_like_fixture() + "\napp.trustweb.one {\n\tfile_server\n}\n", [caddy.Transform.APP_TRUSTWEB_ONE])
        with self.assertRaises(caddy.TransformError):
            caddy.apply(live_like_fixture() + "\nfoo.example, app.trustweb.one {\n\tfile_server\n}\n", [caddy.Transform.APP_TRUSTWEB_ONE])

    def test_demo_block_redirects_to_the_demo_path_without_doubling_it(self) -> None:
        out = caddy.apply(live_like_fixture(), [caddy.Transform.DEMO_TRUSTWEB_ONE])
        block = block_of(out, "demo.trustweb.one {")
        self.assertIn("redir https://app.trustweb.one/demo{uri} permanent", block)
        self.assertLess(block.index("@demo_already"), block.index("redir https://app.trustweb.one/demo{uri}"))
        self.assertIn("redir @demo_already https://app.trustweb.one{uri} permanent", block)
        self.assertEqual(caddy.apply(out, [caddy.Transform.DEMO_TRUSTWEB_ONE]), out)
        with self.assertRaises(caddy.TransformError):
            caddy.apply(live_like_fixture() + "\ndemo.trustweb.one {\n\tfile_server\n}\n", [caddy.Transform.DEMO_TRUSTWEB_ONE])

    def test_never_touches_the_apex_redirect_or_the_old_app_hosts(self) -> None:
        live = live_like_fixture()
        out = caddy.apply(live, [caddy.Transform.APP_TRUSTWEB_ONE, caddy.Transform.DEMO_TRUSTWEB_ONE])
        self.assertEqual(block_of(out, "trustweb.one, www.trustweb.one {"), block_of(live, "trustweb.one, www.trustweb.one {"))
        self.assertEqual(out.count("\ntrustweb.one, www.trustweb.one {\n"), 1)
        self.assertNotIn("redir https://app.trustintheweb.org", out)


class AppOrgRedirect(unittest.TestCase):
    """Wave 6c, Jakob 12:53: app.trustintheweb.org page loads 301 to app.trustweb.one; its API handles keep serving."""

    def redirected(self) -> str:
        live = live_like_fixture()
        with_one = caddy.apply(live, [caddy.Transform.APP_TRUSTWEB_ONE])
        return caddy.apply(with_one, [caddy.Transform.APP_ORG_REDIRECT])

    def test_only_the_page_catch_all_changes_and_every_api_handle_stays(self) -> None:
        live = live_like_fixture()
        out = self.redirected()
        org = block_of(out, "app.trustintheweb.org {")
        self.assertIn("redir https://app.trustweb.one{uri} permanent", org)
        self.assertNotIn("file_server", org)
        for route in ("handle /relay/*", "handle /backup/*", "handle /hosted/*", "handle /transcribe", "handle /feedback", "handle /websearch*", "handle /link", "handle /l/*"):
            self.assertIn(route, org)
        # everything of the block above the catch-all is byte-identical to before
        before = block_of(live, "app.trustintheweb.org {")
        head = before[:before.index(caddy.ORG_SERVE_CATCHALL)]
        self.assertTrue(org.startswith(head))
        # the app folder is not renamed or dropped from the file: only the comment names it
        self.assertNotIn("root *", org)

    def test_idempotent_and_refused_without_the_new_host(self) -> None:
        once = self.redirected()
        self.assertEqual(caddy.apply(once, [caddy.Transform.APP_ORG_REDIRECT]), once)
        with self.assertRaises(caddy.TransformError):
            caddy.apply(live_like_fixture(), [caddy.Transform.APP_ORG_REDIRECT])

    def test_the_new_host_never_inherits_the_redirect_and_parity_holds_either_way(self) -> None:
        once = self.redirected()
        again = caddy.apply(once, [caddy.Transform.APP_TRUSTWEB_ONE])  # the gate-2 rerun, with the redirect already live
        one = block_of(again, "app.trustweb.one {")
        self.assertNotIn("redir https://app.trustweb.one", one)
        self.assertIn("root * /srv/questhub-static/app-trustweb-one\n", one)
        self.assertIn("file_server", one)
        self.assertEqual(caddy.app_block_parity(once), [])
        self.assertEqual(caddy.app_block_parity(again), [])
        self.assertEqual(again, once)

    def test_a_later_api_route_reaches_the_new_host_even_with_the_redirect_live(self) -> None:
        once = self.redirected()
        later = once.replace(RELAY_ANCHOR, "\thandle /connect {\n\t\tlog_skip\n\t\treverse_proxy 127.0.0.1:8960\n\t}\n" + RELAY_ANCHOR, 1)
        synced = caddy.apply(later, [caddy.Transform.APP_TRUSTWEB_ONE])
        self.assertIn("handle /connect", block_of(synced, "app.trustweb.one {"))
        self.assertIn("handle /connect", block_of(synced, "app.trustintheweb.org {"))
        self.assertNotIn("redir https://app.trustweb.one", block_of(synced, "app.trustweb.one {"))

    def test_apex_and_idea2_hosts_are_untouched(self) -> None:
        live = live_like_fixture()
        out = self.redirected()
        self.assertEqual(block_of(out, "trustweb.one, www.trustweb.one {"), block_of(live, "trustweb.one, www.trustweb.one {"))
        self.assertEqual(block_of(out, "idea2.site, www.idea2.site {"), block_of(live, "idea2.site, www.idea2.site {"))



class OrgRedirectIsNotCached(unittest.TestCase):
    """Review 6c: lifting the A1 redirect is the only way back to an app.trustintheweb.org phone's own data, so no browser may keep the 301."""

    def test_the_redirect_handle_says_no_store_before_redir_and_the_new_host_does_not_inherit_it(self) -> None:
        once = caddy.apply(caddy.apply(live_like_fixture(), [caddy.Transform.APP_TRUSTWEB_ONE]), [caddy.Transform.APP_ORG_REDIRECT])
        org = block_of(once, "app.trustintheweb.org {")
        handle = org[org.rindex("\thandle {\n"):]
        self.assertIn('\t\theader Cache-Control "no-store"\n', handle)
        self.assertLess(handle.index("header Cache-Control"), handle.index("redir https://app.trustweb.one{uri} permanent"))
        self.assertIn("Caddyfile.bak.<ts>", org)
        self.assertNotIn("_wave6c_orgredirect", org)
        self.assertNotIn('"no-store"', block_of(once, "app.trustweb.one {"))


REPO = Path(__file__).resolve().parent.parent


def _read(rel: str) -> str:
    return (REPO / rel).read_text(encoding="utf-8")


def _shell_value(rel: str, name: str) -> str:
    m = re.search(rf'^{name}="([^"]*)"$', _read(rel), re.MULTILINE)
    assert m is not None, f"{name} not found in {rel}"
    return m.group(1)


def _js_string(rel: str, name: str) -> str:
    m = re.search(rf"^const {name} = '([^']*)'$", _read(rel), re.MULTILINE)
    assert m is not None, f"{name} not found in {rel}"
    return m.group(1)


def _shell_function(rel: str, name: str) -> str:
    m = re.search(rf"^{name}\(\) \{{.*?^\}}$", _read(rel), re.MULTILINE | re.DOTALL)
    assert m is not None, f"{name}() not found in {rel}"
    return m.group(0)


APP_HOSTS = {"app.idea2.site", "app.trustintheweb.org", "app.trustweb.one"}
SITE_ORIGINS = {"https://idea2.site", "https://trustintheweb.org", "https://trustintheweb.com"}


class HostListsAgreeAcrossFiles(unittest.TestCase):
    """Review 6c: every list of app hosts and feedback origins (app, service defaults, unit, drop-in) names the same exact set."""

    def test_app_host_lists_are_one_set(self) -> None:
        m = re.search(r"SHORT_LINK_ORIGINS: readonly string\[\] = \[([^\]]*)\]", _read("apps/trustweb/src/short_link.ts"))
        assert m is not None
        origins = re.findall(r"'([^']*)'", m.group(1))
        self.assertEqual({urlsplit(o).hostname for o in origins}, APP_HOSTS)
        lists = {
            "short_link.ts": [urlsplit(o).hostname or "" for o in origins],
            "config.mjs DEFAULT_LINK_HOSTS": _js_string("services/trustweb-backup/config.mjs", "DEFAULT_LINK_HOSTS").split(","),
            "deploy_trustweb_backup.sh ALLOWED_HOSTS_PRODUCTION": _shell_value("scripts/deploy_trustweb_backup.sh", "ALLOWED_HOSTS_PRODUCTION").split(","),
            "deploy_trustweb_backup.sh LINK_HOSTS_ALL": _shell_value("scripts/deploy_trustweb_backup.sh", "LINK_HOSTS_ALL").split(","),
            "trustweb_domains.sh APP_HOSTS": _shell_value("scripts/trustweb_domains.sh", "APP_HOSTS").split(" "),
            "trustweb_domains.sh ALLOWED_HOSTS": _shell_value("scripts/trustweb_domains.sh", "ALLOWED_HOSTS").split(","),
            "trustweb_domains.sh LINK_HOSTS": _shell_value("scripts/trustweb_domains.sh", "LINK_HOSTS").split(","),
        }
        for where, hosts in lists.items():
            self.assertEqual(len(hosts), len(set(hosts)), where)
            self.assertEqual(set(hosts), APP_HOSTS, where)
        for o in origins:
            parts = urlsplit(o)
            self.assertEqual((parts.scheme, parts.port, parts.path, parts.query, parts.fragment), ("https", None, "", "", ""), o)

    def test_feedback_origins_are_the_app_origins_plus_the_three_sites_and_nothing_else(self) -> None:
        want = {f"https://{h}" for h in APP_HOSTS} | SITE_ORIGINS
        for where, raw in (
            ("config.mjs", _js_string("services/trustweb-backup/config.mjs", "DEFAULT_FEEDBACK_ORIGINS")),
            ("deploy_trustweb_backup.sh", _shell_value("scripts/deploy_trustweb_backup.sh", "FEEDBACK_ORIGINS_ALL")),
            ("trustweb_domains.sh", _shell_value("scripts/trustweb_domains.sh", "FEEDBACK_ORIGINS")),
        ):
            origins = raw.split(",")
            self.assertEqual(len(origins), len(set(origins)), where)
            self.assertEqual(set(origins), want, where)
            self.assertNotIn("https://trustweb.one", origins, where)
            self.assertFalse(any("demo." in o for o in origins), where)

    def test_the_new_app_folder_is_named_the_same_everywhere(self) -> None:
        self.assertEqual(caddy.APP_ONE_DIR, "/srv/questhub-static/app-trustweb-one")
        self.assertIn(f"CARD_DIR_TRUSTWEB_ONE={caddy.APP_ONE_DIR}\n", _read("scripts/deploy_trustweb_peer.sh"))
        self.assertIn("$CARD_DIR_TRUSTWEB_ONE", _read("scripts/deploy_trustweb_peer.sh"))
        self.assertIn(f"REMOTE_TRUSTWEB_ONE={caddy.APP_ONE_DIR}\n", _read("scripts/deploy_wot.sh"))
        self.assertIn("APP_ONE_DIR=$STATIC/app-trustweb-one\n", _read("scripts/trustweb_domains.sh"))


def _bash(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", "-c", "set -euo pipefail\n" + script], capture_output=True, text=True, timeout=30, check=False)


class OrgRedirectProbe(unittest.TestCase):
    """Review 6c: org-redirect runs only when app.trustweb.one serves the app AND its backup answers (a stale drop-in = 421 there)."""

    def ok(self, probe: str) -> bool:
        fn = _shell_function("scripts/trustweb_domains.sh", "org_probe_ok")
        return _bash(f"{fn}\norg_probe_ok '{probe}'").returncode == 0

    def test_accepts_only_a_serving_app_with_a_healthy_backup(self) -> None:
        self.assertTrue(self.ok("200 1 200 200 "))
        self.assertTrue(self.ok("200 12 200 200"))
        for bad in ("200 1 200 421 ", "200 0 200 200 ", "404 1 200 200 ", "200 1 404 200 ", "000 200 200 ", "200 1 200 ", "",
                    "200 1 200 200 200 ", "200 x 200 200 "):
            self.assertFalse(self.ok(bad), bad)


class BackupDeployChecksEveryHost(unittest.TestCase):
    """Review 6c: a production deploy fails, naming backup-env, when the effective environment refuses an app host."""

    def run_check(self, refused_host: str) -> subprocess.CompletedProcess[str]:
        fn = _shell_function("scripts/deploy_trustweb_backup.sh", "verify_every_app_host")
        hosts = _shell_value("scripts/deploy_trustweb_backup.sh", "ALLOWED_HOSTS_PRODUCTION")
        stub = (
            'rsh() { case "$1" in *"Host: ' + refused_host + '\'"*) echo 421; return 0 ;; esac\n'
            '  case "$1" in *"-X OPTIONS"*) echo 204 ;; *) echo 200 ;; esac; }\n'
        )
        return _bash(f'ALLOWED_HOSTS_PRODUCTION="{hosts}"\n{stub}{fn}\nverify_every_app_host')

    def test_all_hosts_served(self) -> None:
        r = self.run_check("nobody.example")
        self.assertEqual(r.returncode, 0, r.stderr)
        for host in APP_HOSTS:
            self.assertIn(f"ok   Host {host} -> /health 200", r.stdout)
            self.assertIn(f"ok   Origin https://{host} -> feedback preflight 204", r.stdout)

    def test_a_refused_new_host_fails_and_names_backup_env(self) -> None:
        r = self.run_check("app.trustweb.one")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("FAIL Host app.trustweb.one -> /health 421", r.stderr)
        self.assertIn("trustweb_domains.sh backup-env", r.stderr)


if __name__ == "__main__":
    unittest.main()
