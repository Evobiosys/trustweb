# SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
"""Tests of scripts/trustweb_namecap_caddy_edit.py (wave 22) against the wave-6c fixture after the connect edit (which brings `handle /name {`).

  python3 -I -m unittest discover -s scripts -p 'test_trustweb_namecap_caddy.py'
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONNECT_EDIT = HERE / "trustweb_connect_caddy_edit.py"
EDIT = HERE / "trustweb_namecap_caddy_edit.py"
FIXTURE = HERE / "fixtures" / "caddyfile_after_wave6c.fixture"
APP_BLOCKS = ("app.idea2.site {\n", "app.trustintheweb.org {\n", "app.trustweb.one {\n")
ROUTE = "\thandle /names/cap-request {\n"


def run(script: Path, src: Path, dst: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-I", str(script), str(src), str(dst)], capture_output=True, text=True)


class NamecapCaddyEdit(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        base = self.tmp / "base"
        done = run(CONNECT_EDIT, FIXTURE, base)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.base = base.read_text()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def edited(self, text: str | None = None) -> str:
        src, out = self.tmp / "in", self.tmp / "out"
        src.write_text(self.base if text is None else text)
        done = run(EDIT, src, out)
        self.assertEqual(done.returncode, 0, done.stderr)
        return out.read_text()

    def test_adds_the_route_once_per_app_block_after_the_name_block_and_nowhere_else(self) -> None:
        once = self.edited()
        self.assertEqual(once.count(ROUTE), 3)
        for head in APP_BLOCKS:
            start = once.index(head)
            block = once[start : once.index("\n}\n", start)]
            self.assertEqual(block.count(ROUTE), 1, head)
            self.assertLess(block.index("handle /name {"), block.index(ROUTE))
            self.assertLess(block.index(ROUTE), block.index("handle /who/* {"))
        self.assertNotIn("cap-request", once[: once.index("app.idea2.site {")])

    def test_route_has_the_name_shape_query_guard_body_cap_log_skip_and_same_upstream(self) -> None:
        once = self.edited()
        start = once.index(ROUTE)
        self.assertEqual(
            once[start : once.index("\n\t}\n", start) + 4],
            ROUTE
            + "\t\tlog_skip\n"
            "\t\t@namecap_query expression {http.request.uri.query} != ''\n"
            "\t\trespond @namecap_query 400\n"
            "\t\trequest_body {\n\t\t\tmax_size 4KB\n\t\t}\n"
            "\t\treverse_proxy 127.0.0.1:8960\n\t}\n",
        )

    def test_idempotent_two_runs_are_byte_identical(self) -> None:
        once = self.edited()
        self.assertEqual(once, self.edited(once))
        self.assertNotEqual(once, self.base)

    def test_everything_else_is_untouched(self) -> None:
        once = self.edited()
        stripped = once
        for _ in range(3):
            start = stripped.index("\t# --- TrustWeb name capability requests")
            end = stripped.index("\n\t}\n", stripped.index(ROUTE, start)) + 4
            stripped = stripped[:start] + stripped[end:]
        self.assertEqual(stripped, self.base)

    def test_a_block_without_the_name_handle_is_refused_and_nothing_is_written(self) -> None:
        src, out = self.tmp / "shape", self.tmp / "shape.out"
        src.write_text(self.base.replace("\thandle /name {\n", "\thandle /other {\n", 1))
        done = run(EDIT, src, out)
        self.assertEqual(done.returncode, 1)
        self.assertIn("handle /name {", done.stderr)
        self.assertFalse(out.exists())

    def test_a_missing_or_duplicated_site_block_is_refused(self) -> None:
        for label, shape in {
            "no trustweb.one block": self.base.replace("app.trustweb.one {\n", "app.trustweb.example {\n"),
            "duplicated idea2 block": self.base + "\napp.idea2.site {\n\thandle {\n\t}\n}\n",
        }.items():
            with self.subTest(label):
                src, out = self.tmp / "s", self.tmp / "s.out"
                out.unlink(missing_ok=True)
                src.write_text(shape)
                self.assertEqual(run(EDIT, src, out).returncode, 1)
                self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
