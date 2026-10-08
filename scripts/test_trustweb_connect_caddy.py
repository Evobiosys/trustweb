"""Tests of scripts/trustweb_connect_caddy_edit.py (wave 6b) against a fixture Caddyfile in the post-wave-6c shape (three app blocks,
the app.trustintheweb.org page catch-all redirecting to app.trustweb.one).

  python3 -I -m unittest discover -s scripts -p 'test_trustweb_connect_caddy.py'
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EDIT = HERE / "trustweb_connect_caddy_edit.py"
FIXTURE = HERE / "fixtures" / "caddyfile_after_wave6c.fixture"
APP_BLOCKS = ("app.idea2.site {\n", "app.trustintheweb.org {\n", "app.trustweb.one {\n")
ROUTES = ("handle /connect {", "handle /c/* {", "handle /name {", "handle /who/* {")


def run(src: Path, dst: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-I", str(EDIT), str(src), str(dst)], capture_output=True, text=True)


class ConnectCaddyEdit(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def edited(self, text: str | None = None) -> str:
        src = self.tmp / "in"
        src.write_text(FIXTURE.read_text() if text is None else text)
        out = self.tmp / "out"
        done = run(src, out)
        self.assertEqual(done.returncode, 0, done.stderr)
        return out.read_text()

    def test_adds_all_four_routes_to_the_three_app_blocks_after_the_l_block_and_nowhere_else(self) -> None:
        once = self.edited()
        for head in APP_BLOCKS:
            start = once.index(head)
            block = once[start : once.index("\n}\n", start)]
            for route in ROUTES:
                self.assertEqual(block.count("\t" + route + "\n"), 1, (head, route))
            self.assertLess(block.index("handle /l/* {"), block.index("handle /connect {"))
            self.assertLess(block.index("handle /who/* {"), block.index("handle /relay/* {"))
        for route in ROUTES:
            self.assertEqual(once.count("\t" + route + "\n"), 3)
        self.assertNotIn("handle /connect", once[once.index("questhub.eco {") : once.index("app.idea2.site {")])
        self.assertEqual(once.splitlines().count("\t\tlog_skip"), 3 * 6)  # /link and /l/* plus the four new routes, in each of the three blocks

    def test_post_routes_have_the_query_guard_and_the_body_cap_and_the_get_routes_accept_a_query(self) -> None:
        once = self.edited()
        for route, matcher in (("/connect", "@connect_query"), ("/name", "@name_query")):
            start = once.index(f"\thandle {route} {{\n")
            body = once[start : once.index("\n\t}\n", start)]
            self.assertIn(f"{matcher} expression {{http.request.uri.query}} != ''", body)
            self.assertIn(f"respond {matcher} 400", body)
            self.assertIn("max_size 4KB", body)
            self.assertIn("log_skip", body)
        for route in ("/c/*", "/who/*"):
            start = once.index(f"\thandle {route} {{\n")
            body = once[start : once.index("\n\t}\n", start)]
            self.assertNotIn("query", body)
            self.assertNotIn("respond", body)
            self.assertIn("log_skip", body)

    def test_idempotent_two_runs_are_byte_identical(self) -> None:
        once = self.edited()
        twice = self.edited(once)
        self.assertEqual(once, twice)
        self.assertNotEqual(once, FIXTURE.read_text())

    def test_everything_else_is_untouched(self) -> None:
        once = self.edited()
        stripped = once
        for _ in range(3):
            start = stripped.index("\t# --- TrustWeb connect codes and usernames")
            end = stripped.index("\thandle /who/* {\n", start)
            end = stripped.index("\n\t}\n", end) + 4
            stripped = stripped[:start] + stripped[end:]
        self.assertEqual(stripped, FIXTURE.read_text())

    def test_a_partial_state_aborts_without_writing(self) -> None:
        src, out = self.tmp / "partial", self.tmp / "partial.out"
        # rename /name in the first block only: that block then has 3 of the 4 routes
        src.write_text(self.edited().replace("\thandle /name {\n", "\thandle /other {\n", 1))
        done = run(src, out)
        self.assertEqual(done.returncode, 1)
        self.assertIn("only some of the connect routes", done.stderr)
        self.assertFalse(out.exists())

    def test_a_missing_or_duplicated_anchor_aborts_without_writing(self) -> None:
        text = FIXTURE.read_text()
        anchor = "\thandle /l/* {\n\t\tlog_skip\n\t\treverse_proxy 127.0.0.1:8960\n\t}\n"
        shapes = {
            "no anchor in the first block": text.replace(anchor, "", 1),
            "an edited anchor": text.replace("\t\tlog_skip\n\t\treverse_proxy 127.0.0.1:8960\n\t}\n\thandle /relay/*", "\t\treverse_proxy 127.0.0.1:8960\n\t}\n\thandle /relay/*", 1),
            "a duplicated anchor": text.replace(anchor, anchor + anchor, 1),
            "no second app block": text.replace("app.trustintheweb.org {\n", "app.trustintheweb.example {\n"),
            "no app.trustweb.one block": text.replace("app.trustweb.one {\n", "app.trustweb.example {\n"),
            "two first app blocks": text + "\napp.idea2.site {\n\thandle {\n\t}\n}\n",
        }
        for label, shape in shapes.items():
            with self.subTest(label):
                src, out = self.tmp / "shape", self.tmp / "shape.out"
                out.unlink(missing_ok=True)
                src.write_text(shape)
                done = run(src, out)
                self.assertEqual(done.returncode, 1, done.stderr)
                self.assertFalse(out.exists(), "nothing is written on an unexpected shape")

    def test_the_new_routes_sit_above_each_page_catch_all_and_the_org_redirect_stays_last(self) -> None:
        once = self.edited()
        for head in APP_BLOCKS:
            start = once.index(head)
            block = once[start : once.index("\n}\n", start) + 3]
            self.assertLess(block.index("handle /who/* {"), block.rindex("\thandle {\n"), head)
        org = once[once.index("app.trustintheweb.org {\n") :]
        org = org[: org.index("\n}\n") + 3]
        self.assertTrue(org.endswith('\thandle {\n\t\theader Cache-Control "no-store"\n\t\tredir https://app.trustweb.one{uri} permanent\n\t}\n}\n'))

    def test_org_and_one_blocks_get_byte_identical_routes(self) -> None:
        once = self.edited()

        def routes(head: str) -> str:
            start = once.index(head)
            block = once[start : once.index("\n}\n", start)]
            first = block.index("\t# --- TrustWeb connect codes and usernames")
            return block[first : block.index("\n\t}\n", block.index("\thandle /who/* {\n")) + 4]

        self.assertEqual(routes("app.trustintheweb.org {\n"), routes("app.trustweb.one {\n"))
        self.assertEqual(routes("app.idea2.site {\n"), routes("app.trustweb.one {\n"))

    def test_usage_error_and_missing_input_write_nothing(self) -> None:
        done = subprocess.run([sys.executable, "-I", str(EDIT)], capture_output=True, text=True)
        self.assertNotEqual(done.returncode, 0)
        out = self.tmp / "never"
        done = run(self.tmp / "does-not-exist", out)
        self.assertNotEqual(done.returncode, 0)
        self.assertFalse(out.exists())


UPSTREAM = "reverse_proxy 127.0.0.1:8960"
ADMIN_PATHS = ("/admin/name", "/admin/names")
LINKS_EDIT = HERE / "trustweb_links_caddy_edit.py"
DEPLOY = HERE / "deploy_trustweb_backup.sh"
CADDY_TOOLS = sorted(
    p for p in HERE.iterdir() if "caddy" in p.name and p.suffix in {".py", ".sh", ".diff"} and not p.name.startswith("test_")
)


def handles_to_service(caddyfile: str) -> list[tuple[str, str]]:
    """[(site block head, handle matcher)] for every handle block of an app site block that proxies to the trustweb-backup service (127.0.0.1:8960).
    A bare `handle {` is reported as "" (the catch-all). Plain-text reading of the files the edit scripts produce; not a Caddy parser."""
    found: list[tuple[str, str]] = []
    block = ""
    for chunk in caddyfile.split("\n}\n"):
        lines = chunk.splitlines()
        head = next((ln for ln in lines if ln.endswith(" {") and not ln.startswith(("\t", "#"))), "")
        block = head[:-2] if head else block
        if not block.startswith("app."):
            continue
        for i, line in enumerate(lines):
            if line.startswith("\thandle") and line.endswith("{"):
                end = next((j for j in range(i + 1, len(lines)) if lines[j] == "\t}"), len(lines))
                if any(UPSTREAM in ln for ln in lines[i:end]):
                    found.append((block, line.removeprefix("\thandle").removesuffix("{").strip()))
    return found


def caddy_matches(matcher: str, path: str) -> bool:
    """Would a `handle <matcher>` take `path`? "" = catch-all; a trailing * = prefix; otherwise exact."""
    if matcher == "":
        return True
    return path.startswith(matcher[:-1]) if matcher.endswith("*") else path == matcher


class NoAdminRouteInCaddy(unittest.TestCase):
    """Wave 6e: /admin/name and /admin/names are loopback-only and must NEVER be reachable through Caddy. These checks read the FIXTURE and the edit/install
    scripts, not the live Caddyfile; the orchestrator confirms the live file with `grep -n admin /etc/caddy/Caddyfile` after any Caddy edit."""

    def edited_fixture(self) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out"
            done = run(FIXTURE, out)
            self.assertEqual(done.returncode, 0, done.stderr)
            return out.read_text()

    def test_the_fixture_and_the_connect_edit_output_mention_no_admin_route(self) -> None:
        for text in (FIXTURE.read_text(), self.edited_fixture()):
            self.assertNotIn("/admin", text)
            self.assertNotIn("admin/name", text)

    def test_no_handle_that_proxies_to_the_service_can_take_an_admin_path(self) -> None:
        for name, text in (("fixture", FIXTURE.read_text()), ("edited", self.edited_fixture())):
            proxied = handles_to_service(text)
            self.assertGreater(len(proxied), 6, name)  # the reader really found the routes (backup, websearch, link, l, ...)
            for site, matcher in proxied:
                for path in ADMIN_PATHS:
                    self.assertFalse(caddy_matches(matcher, path), f"{name}: {site} handle {matcher!r} would forward {path} to the service")
            self.assertNotIn("", [m for _, m in proxied], f"{name}: a catch-all handle must not proxy to the service")

    def test_the_links_edit_output_and_the_print_caddy_snippet_mention_no_admin_route(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "links_out"
            done = subprocess.run([sys.executable, "-I", str(LINKS_EDIT), str(FIXTURE), str(out)], capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertNotIn("/admin", out.read_text())
        snippet = subprocess.run(["bash", str(DEPLOY), "--print-caddy"], capture_output=True, text=True)
        self.assertEqual(snippet.returncode, 0, snippet.stderr)
        self.assertIn("handle /hosted/*", snippet.stdout)
        self.assertNotIn("/admin", snippet.stdout)

    def test_no_caddy_edit_or_install_script_or_proposal_mentions_an_admin_route(self) -> None:
        self.assertGreaterEqual(len(CADDY_TOOLS), 6)
        for tool in CADDY_TOOLS:
            self.assertNotIn("/admin", tool.read_text(), tool.name)


if __name__ == "__main__":
    unittest.main()
