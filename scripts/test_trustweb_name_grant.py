"""Tests of scripts/trustweb_name_grant.sh (wave 6e) against a REAL local trustweb-backup server on 127.0.0.1:8970 (port 8971 is kept empty on purpose:
the "host unreachable" case). The script's ssh hop is replaced by TW_GRANT_TRANSPORT=local with a throwaway token file; nothing here touches a real host.

  python3 -I -B -m unittest discover -s scripts -p 'test_trustweb_name_grant.py'
"""
from __future__ import annotations

import http.client
import json
import os
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SCRIPT = HERE / "trustweb_name_grant.sh"
SERVER = REPO / "services" / "trustweb-backup" / "server.mjs"
PORT = 8970
EMPTY_PORT = 8971
HOST = "app.idea2.site"
TOKEN = "ab" * 32
OTHER_TOKEN = "cd" * 32
LONG = "https://app.idea2.site/trustweb/?connect=did%3Apeer%3A2.Ez6LSgrantTest&id=p-1"
NODE = shutil.which("node")
CURL = shutil.which("curl")


def request(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    """A request to the test server as the app makes it (public Host)."""
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    try:
        conn.putrequest(method, path, skip_host=True)
        conn.putheader("Host", HOST)
        data = json.dumps(body).encode() if body is not None else None
        if data is not None:
            conn.putheader("Content-Type", "application/json")
            conn.putheader("Content-Length", str(len(data)))
        conn.endheaders(data)
        res = conn.getresponse()
        text = res.read().decode()
        return res.status, (json.loads(text) if text.startswith("{") else {})
    finally:
        conn.close()


@unittest.skipUnless(NODE and CURL, "node and curl are needed")
class NameGrantScript(unittest.TestCase):
    server: subprocess.Popen[bytes]
    tmp: Path
    token_file: Path

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp(prefix="twgrant-"))
        cls.token_file = cls.tmp / "admin.json"
        cls.token_file.write_text(json.dumps({"token": TOKEN}))
        cls.token_file.chmod(0o600)
        env = {
            "PATH": os.environ["PATH"],
            "BACKUP_DIR": str(cls.tmp / "backup"),
            "PORT": str(PORT),
            "HOST": "127.0.0.1",
            "ALLOWED_HOSTS": HOST,
            "RESERVED_NAMES": "japossert,jakob",
            "ADMIN_TOKEN_FILE": str(cls.token_file),
            "RATE_LIMIT": "100000",
            "CONNECT_PER_MINUTE": "10000",
            "CONNECT_PER_HOUR": "10000",
        }
        cls.server = subprocess.Popen([NODE, str(SERVER)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                if request("GET", "/health")[0] == 200:
                    return
            except (OSError, ValueError):
                time.sleep(0.1)
        cls.tearDownClass()
        raise RuntimeError("the test server did not start on 127.0.0.1:%d" % PORT)

    @classmethod
    def tearDownClass(cls) -> None:
        server = getattr(cls, "server", None)
        if server is not None and server.poll() is None:
            server.send_signal(signal.SIGTERM)
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ------------------------------------------------------------ helpers

    def mint(self) -> dict:
        status, body = request("POST", "/connect", {"url": LONG})
        self.assertEqual(status, 201, body)
        return body

    def names_of(self, minted: dict) -> dict:
        status, body = request("POST", "/name", {"code": minted["code"], "secret": minted["secret"]})
        self.assertEqual(status, 200, body)
        return body

    def run_script(self, *args: str, stdin: str = "", port: int = PORT, token_file: Path | None = None, path_prefix: Path | None = None, transport: str = "local") -> subprocess.CompletedProcess[str]:
        env = {
            "PATH": (f"{path_prefix}:" if path_prefix else "") + os.environ["PATH"],
            "HOME": str(self.tmp),
            "TW_GRANT_TRANSPORT": transport,
            "TW_GRANT_PORT": str(port),
            "TW_GRANT_TOKEN_FILE": str(token_file or self.token_file),
        }
        return subprocess.run(["bash", str(SCRIPT), *args], input=stdin, capture_output=True, text=True, env=env, timeout=60)

    def assertNoToken(self, done: subprocess.CompletedProcess[str]) -> None:
        for token in (TOKEN, OTHER_TOKEN):
            self.assertNotIn(token, done.stdout)
            self.assertNotIn(token, done.stderr)

    # ------------------------------------------------------------ the tests

    def test_the_script_is_executable_and_has_the_start_line_and_separators(self) -> None:
        self.assertTrue(SCRIPT.stat().st_mode & stat.S_IXUSR)
        done = self.run_script("--host", "questhub", "--list")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(done.stdout.startswith("... trustweb_name_grant running ...\n--------\n"))
        self.assertEqual(subprocess.run(["bash", "-n", str(SCRIPT)]).returncode, 0)

    def test_list_is_read_only_and_shows_the_env_reserved_names_with_no_holder(self) -> None:
        done = self.run_script("--host", "questhub", "--list")
        self.assertEqual(done.returncode, 0, done.stderr)
        answer = json.loads(done.stdout.split("\n", 2)[2].split("\n--------")[0].split("(read-only):\n")[1])
        self.assertEqual([r["name"] for r in answer["reserved"]][:2], ["japossert", "jakob"])
        self.assertNotIn("Proceed", done.stdout)
        self.assertNoToken(done)

    def test_n_changes_nothing_ENTER_grants_y_adds_an_alias_yes_removes(self) -> None:
        minted = self.mint()
        code = minted["code"]
        declined = self.run_script("--host", "questhub", "--code", code, "--name", "japossert", stdin="n\n")
        self.assertEqual(declined.returncode, 0, declined.stderr)
        self.assertIn("nothing changed.", declined.stdout)
        self.assertIn("Proceed? ENTER or y or n", declined.stdout)
        self.assertEqual(self.names_of(minted), {"name": "", "aliases": [], "locked": []})
        self.assertNotIn(code, declined.stdout, "the code is shown masked in the plan")

        granted = self.run_script("--host", "questhub", "--code", code, "--name", "japossert", stdin="\n")
        self.assertEqual(granted.returncode, 0, granted.stderr)
        self.assertIn('{"name":"japossert","aliases":[],"locked":["japossert"]}', granted.stdout)
        self.assertEqual(self.names_of(minted), {"name": "japossert", "aliases": [], "locked": ["japossert"]})

        aliased = self.run_script("--host", "questhub", "--code", code, "--alias", "jakob", stdin="y\n")
        self.assertEqual(aliased.returncode, 0, aliased.stderr)
        self.assertEqual(self.names_of(minted), {"name": "japossert", "aliases": ["jakob"], "locked": ["japossert", "jakob"]})

        removed = self.run_script("--host", "questhub", "--code", code, "--remove", "jakob", "--yes")
        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertEqual(self.names_of(minted), {"name": "japossert", "aliases": [], "locked": ["japossert"]})
        listing = self.run_script("--host", "questhub", "--list")
        self.assertIn(code, listing.stdout, "the operator's list shows who holds japossert")
        for done in (declined, granted, aliased, removed, listing):
            self.assertNoToken(done)

    def test_name_and_alias_together_grant_both_in_order(self) -> None:
        minted = self.mint()
        done = self.run_script("--host", "questhub", "--code", minted["code"], "--name", "grace.k", "--alias", "gk.two", "--yes")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.names_of(minted), {"name": "grace.k", "aliases": ["gk.two"], "locked": []})
        self.assertLess(done.stdout.index('{"name":"grace.k","aliases":[],"locked":[]}'), done.stdout.index('{"name":"grace.k","aliases":["gk.two"],"locked":[]}'))

    def test_a_refusal_of_the_server_stops_the_script_with_1_and_prints_the_answer(self) -> None:
        minted = self.mint()
        code = minted["code"]
        self.assertEqual(self.run_script("--host", "questhub", "--code", code, "--name", "kx.one", "--alias", "kx.two", "--yes").returncode, 0)
        self.assertEqual(self.run_script("--host", "questhub", "--code", code, "--name", "kx.three", "--yes").returncode, 0)  # 3 names now
        full = self.run_script("--host", "questhub", "--code", code, "--name", "kx.four", "--yes")
        self.assertEqual(full.returncode, 1)
        self.assertIn('"error":"too_many_names"', full.stdout)
        self.assertIn("refused: HTTP 409", full.stderr)
        self.assertEqual(self.names_of(minted), {"name": "kx.three", "aliases": ["kx.one", "kx.two"], "locked": []})
        unknown = self.run_script("--host", "questhub", "--code", "Z" * 22, "--name", "kx.five", "--yes")
        self.assertEqual(unknown.returncode, 1)
        self.assertIn('"error":"unknown_code"', unknown.stdout)
        absent = self.run_script("--host", "questhub", "--code", code, "--remove", "nothing.here", "--yes")
        self.assertEqual(absent.returncode, 1)
        self.assertIn('"error":"not_held"', absent.stdout)

    def test_an_odd_answer_asks_again_and_a_closed_stdin_is_a_no(self) -> None:
        minted = self.mint()
        odd = self.run_script("--host", "questhub", "--code", minted["code"], "--name", "jakob", stdin="what\nn\n")
        self.assertIn("please answer ENTER, y or n", odd.stdout)
        self.assertIn("nothing changed.", odd.stdout)
        closed = self.run_script("--host", "questhub", "--code", minted["code"], "--name", "jakob", stdin="")
        self.assertEqual(closed.returncode, 0)
        self.assertIn("nothing changed.", closed.stdout)
        self.assertEqual(self.names_of(minted), {"name": "", "aliases": [], "locked": []})

    def test_a_wrong_token_is_refused_by_the_server_and_never_printed(self) -> None:
        wrong = self.tmp / "wrong.json"
        wrong.write_text(json.dumps({"token": OTHER_TOKEN}))
        done = self.run_script("--host", "questhub", "--list", token_file=wrong)
        self.assertEqual(done.returncode, 1)
        self.assertIn("refused: HTTP 401", done.stderr)
        self.assertNoToken(done)

    def test_a_missing_or_malformed_token_file_and_an_unreachable_server_stop_with_3(self) -> None:
        bad = self.tmp / "bad.json"
        bad.write_text(json.dumps({"key": TOKEN}))
        for token_file in (bad, self.tmp / "missing.json"):
            done = self.run_script("--host", "questhub", "--list", token_file=token_file)
            self.assertEqual(done.returncode, 3, done.stderr)
            self.assertNoToken(done)
        down = self.run_script("--host", "questhub", "--list", port=EMPTY_PORT)
        self.assertEqual(down.returncode, 3, down.stderr)

    def test_bad_arguments_exit_2_before_any_call(self) -> None:
        code = "A" * 22
        cases = [
            ("--list",),
            ("--host", "sebra", "--list"),
            ("--host", "questhub"),
            ("--host", "questhub", "--code", "short", "--name", "japossert"),
            ("--host", "questhub", "--code", code),
            ("--host", "questhub", "--code", code, "--name", "Japossert"),
            ("--host", "questhub", "--code", code, "--name", "ab"),
            ("--host", "questhub", "--code", code, "--alias", 'x"y\\'),
            ("--host", "questhub", "--code", code, "--name", "jakob", "--alias", "jakob"),
            ("--host", "questhub", "--code", code, "--remove", "jakob", "--name", "japossert"),
            ("--host", "questhub", "--list", "--code", code),
            ("--host", "questhub", "--bogus"),
        ]
        for args in cases:
            done = self.run_script(*args)
            self.assertEqual(done.returncode, 2, (args, done.stdout, done.stderr))
            self.assertNotIn("reserved names and who holds them", done.stdout, args)

    def test_neither_the_token_nor_the_code_is_ever_in_an_argument_list(self) -> None:
        """A curl stub in front of the real curl records its argv and its stdin: the token travels on stdin (-H @-), the body in a file."""
        stubs = self.tmp / "stubs"
        stubs.mkdir()
        argv_log, stdin_log = self.tmp / "curl_argv.log", self.tmp / "curl_stdin.log"
        stub = stubs / "curl"
        stub.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> "{argv_log}"\ncat > "{stdin_log}.in"\ncat "{stdin_log}.in" >> "{stdin_log}"\nexec {CURL} "$@" < "{stdin_log}.in"\n')
        stub.chmod(0o755)
        minted = self.mint()
        done = self.run_script("--host", "questhub", "--code", minted["code"], "--name", "jakob", "--yes", path_prefix=stubs)
        self.assertEqual(done.returncode, 0, done.stderr)
        argv = argv_log.read_text()
        self.assertNotIn(TOKEN, argv)
        self.assertNotIn(minted["code"], argv)
        self.assertIn("-H\n@-\n", argv)
        self.assertIn("--data\n@", argv, "the body comes from a file")
        self.assertIn(f"X-Admin-Token: {TOKEN}", stdin_log.read_text(), "the token went in on stdin")
        self.assertNoToken(done)

    def test_the_ssh_transport_runs_one_fixed_command_and_puts_nothing_secret_in_its_arguments(self) -> None:
        stubs = self.tmp / "sshstubs"
        stubs.mkdir()
        argv_log, stdin_log = self.tmp / "ssh_argv.log", self.tmp / "ssh_stdin.log"
        (stubs / "ssh").write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> "{argv_log}"\ncat >> "{stdin_log}"\nprintf \'{{"reserved":[]}}\\nHTTP 200\\n\'\n')
        (stubs / "ssh-add").write_text("#!/bin/sh\nexit 0\n")
        for name in ("ssh", "ssh-add"):
            (stubs / name).chmod(0o755)
        code = "Q" * 22
        done = self.run_script("--host", "questhub", "--code", code, "--name", "jakob", "--yes", transport="ssh", path_prefix=stubs)
        self.assertEqual(done.returncode, 0, done.stderr)
        argv = argv_log.read_text().splitlines()
        self.assertEqual(argv[:2], ["questhub", "bash -s"])
        self.assertNotIn(code, "\n".join(argv), "the code travels on stdin, not in the command")
        script = stdin_log.read_text()
        self.assertIn("sudo cat /etc/trustweb/admin.json", script)
        self.assertIn("Host: 127.0.0.1:8960", script)
        self.assertIn("http://127.0.0.1:8960/admin/name", script)
        self.assertIn(code, script)
        self.assertNotRegex(script, r"[0-9a-f]{64}\b(?!\\\{)", "no token-like value is written into the script text (the regex in it is a pattern, not a value)")


if __name__ == "__main__":
    unittest.main()
