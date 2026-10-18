"""Offline check of the verdict logic of test_reach_out_chain.py (no network).  python3 -I -m unittest discover -s scripts -p 'test_reach_out_chain_logic.py'"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_reach_out_chain import BUDGET, counts_toward_budget, first_hop_problems, problems, trampoline_next, variants  # noqa: E402

PAGE = b"<!DOCTYPE html>" + b"x" * 1200


class Verdict(unittest.TestCase):
    def test_good_chain(self) -> None:
        hops = [("https://trustweb.one/Ada", 302, "-> https://app.trustweb.one/who/Ada", 0, b""), ("https://app.trustweb.one/", 200, "text/html", len(PAGE), PAGE)]
        self.assertEqual(problems(hops, True), [])

    def test_empty_typeless_404_is_the_bug(self) -> None:
        hops = [("https://trustintheweb.org/Ada", 404, "", 0, b"")]
        self.assertTrue(any("no Content-Type" in b for b in problems(hops, True)))
        self.assertTrue(problems(hops, False))

    def test_unknown_name_needs_html_404_with_body(self) -> None:
        self.assertEqual(problems([("u", 404, "text/html; charset=utf-8", 120, b"<p>x")], False), [])
        self.assertTrue(problems([("u", 404, "text/html", 0, b"")], False))

    def test_5xx_and_no_answer(self) -> None:
        self.assertTrue(problems([("u", 502, "text/html", 50, b"x")], True))
        self.assertTrue(problems([("u", 0, "ERROR timed out", 0, b"")], True))

    def test_variants_cover_the_phone_shapes(self) -> None:
        urls = [u for u, _ in variants("ada", "trustweb.one", "app.trustweb.one")]
        for want in ("https://trustweb.one/Ada", "https://trustweb.one/ada.", "https://trustweb.one/ada/", "http://trustweb.one/ada", "https://app.trustweb.one/who/ada"):
            self.assertIn(want, urls)

    def test_trampoline_continues_at_lowercased_stripped_name(self) -> None:
        body = b"<script>location='https://app.trustweb.one/who/'+n</script>"
        self.assertEqual(trampoline_next("https://trustweb.one/Ada.", 200, "text/html", body, "app.trustweb.one"), "https://app.trustweb.one/who/ada")
        self.assertEqual(trampoline_next("https://trustweb.one/ada/", 200, "text/html", body, "app.trustweb.one"), "https://app.trustweb.one/who/ada")
        self.assertIsNone(trampoline_next("https://trustweb.one/ada", 200, "text/html", b"", "app.trustweb.one"))
        self.assertIsNone(trampoline_next("https://trustweb.one/ada", 200, "text/html", b"<p>hi</p>", "app.trustweb.one"))

    def test_first_hop_accepts_redirect_or_trampoline(self) -> None:
        app = "app.trustweb.one"
        self.assertEqual(first_hop_problems([("u", 302, "-> https://app.trustweb.one/who/ada", 0, b"")], app), [])
        self.assertEqual(first_hop_problems([("u", 200, "text/html", 40, b"x app.trustweb.one/who/ y")], app), [])
        self.assertTrue(first_hop_problems([("u", 200, "text/html", 5, b"hello")], app))

    def test_429_is_a_budget_failure(self) -> None:
        self.assertTrue(any("service budget: run the test less often" in b for b in problems([("u", 429, "text/plain", 9, b"slow down")], True)))
        self.assertTrue(first_hop_problems([("u", 429, "text/plain", 9, b"x")], "app.trustweb.one"))

    def test_budget_count(self) -> None:
        self.assertTrue(counts_toward_budget("https://app.trustweb.one/who/ada"))
        self.assertTrue(counts_toward_budget("https://trustweb.one/c/abc"))
        self.assertFalse(counts_toward_budget("https://trustweb.one/ada"))
        self.assertEqual(BUDGET, 10)


if __name__ == "__main__":
    unittest.main()
