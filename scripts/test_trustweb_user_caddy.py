"""Tests of scripts/trustweb_user_caddy_edit.py: the username routes (wave 8), their case/trailing-punctuation forgiveness and the error pages (wave 14 reach-out-link).

  python3 -I -m unittest discover -s scripts -p 'test_trustweb_user_caddy.py'
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
EDIT = HERE / "trustweb_user_caddy_edit.py"
OLD_NAME = r"^/([a-z0-9][a-z0-9_-]{1,39})$"
FIXTURE = """trustweb.one, www.trustweb.one {
	redir https://trustintheweb.org{uri} permanent
}

trustintheweb.org {
	root * /srv/site
	file_server
}

app.trustweb.one {
	handle /who/* {
		reverse_proxy 127.0.0.1:8960
	}
	handle {
		file_server
	}
}
"""


def run(src: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        a, b = Path(tmp, "in"), Path(tmp, "out")
        a.write_text(src)
        done = subprocess.run([sys.executable, "-I", str(EDIT), str(a), str(b)], capture_output=True, text=True)
        done.stdout += "\0" + (b.read_text() if b.exists() else "")
        return done


def edited(src: str = FIXTURE) -> str:
    done = run(src)
    assert done.returncode == 0, done.stderr
    return done.stdout.split("\0", 1)[1]


class UserCaddyEdit(unittest.TestCase):
    def test_name_pattern_case_insensitive_with_trailing_punctuation(self) -> None:
        out = edited()
        patterns = re.findall(r"path_regexp user (\S+)", out)
        self.assertEqual(len(patterns), 2)
        for pat in patterns:
            rx = re.compile(pat)
            for ok in ("/japossert", "/Japossert", "/japossert.", "/japossert/", "/japossert ", "/Japossert!?", "/ab"):
                self.assertTrue(rx.match(ok), (pat, ok))
            self.assertEqual(rx.match("/Japossert.").group(1), "Japossert")
            for bad in ("/", "/a", "/index.html", "/jap.ossert", "/jap/ossert", "/-ab", "/" + "a" * 41):
                self.assertFalse(rx.match(bad), (pat, bad))
        self.assertIn("redir @user https://app.trustweb.one/who/{re.user.1} 302", out)
        self.assertIn("redir @user /who/{re.user.1} 302", out)

    def test_app_block_keeps_service_and_app_folders_out_with_and_without_slash(self) -> None:
        line = next(l for l in edited().splitlines() if l.strip().startswith("not path"))
        for seg in ("/demo", "/demo/", "/who/", "/assets/", "/pwa"):
            self.assertIn(f" {seg} ", line + " ")

    def test_error_pages_are_html_with_a_body_and_a_retry_link(self) -> None:
        out = edited()
        self.assertEqual(out.count("handle_errors {"), 3)
        self.assertEqual(out.count('header Content-Type "text/html; charset=utf-8"'), 3)
        self.assertIn("https://app.trustweb.one/who/{re.retry.1}", out)
        self.assertIn("This link did not open. Try again:", out)
        self.assertIn("Page not found.", out)
        # no raw path placeholder in any page: the name is only a [A-Za-z0-9_-] capture
        self.assertNotIn("{http.request.uri", out.replace("{http.request.uri.query}", ""))
        # the org block keeps its own directives and still closes its block
        self.assertRegex(out, r"trustintheweb\.org \{\n\troot \* /srv/site\n\tfile_server\n\t# --- reach-out-link errors")

    def test_idempotent(self) -> None:
        once = edited()
        self.assertEqual(edited(once), once)

    def test_upgrades_an_older_wave8_block(self) -> None:
        old = edited().replace(
            re.search(r"path_regexp user (\S+)", edited()).group(1), OLD_NAME
        )
        new = edited(old)
        self.assertNotIn(OLD_NAME, new)
        self.assertEqual(new.count("[A-Za-z0-9][A-Za-z0-9_-]{1,39}"), 4)

    def test_refuses_a_block_with_its_own_handle_errors(self) -> None:
        done = run(FIXTURE.replace("\tfile_server\n}\n\napp", "\tfile_server\n\thandle_errors {\n\t\trespond 500\n\t}\n}\n\napp"))
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("handle_errors", done.stderr)


if __name__ == "__main__":
    unittest.main()
