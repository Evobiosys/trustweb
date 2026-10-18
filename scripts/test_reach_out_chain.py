#!/usr/bin/env python3
"""Reach-out link chain against production (wave 14): trustweb.one/<name> in every shape a phone produces must end in a real page, never an empty download.

  python3 -I scripts/test_reach_out_chain.py [--name japossert] [--host trustweb.one] [--app app.trustweb.one]

Follows redirects hop by hop (no auto-follow). Full chains (lowercase, capitalised, trailing dot, unknown name) with the desktop agent only; android and iphone test just the first hop of two variants.
Service budget (config.mjs CONNECT_GET_PER_MINUTE 20, GET /who + /c together): <= 10 such requests per run, sequential, 300 ms apart; the count is printed.
The trustweb.one hop may answer a 3xx to app.trustweb.one/who/<x> or a 200 text/html "trampoline" page naming it; the chain then continues at /who/<lowercased name>.
Asserts per hop: a Content-Type, or a 3xx with Location; never a 5xx. A 429 waits Retry-After (max 30 s) once, a second 429 fails.
Last hop of a valid name: 200 text/html, body > 1000 bytes with "<!doctype html". Unknown name: 404 text/html with a non-empty body. Exit 1 with a hop table on failure.
"""
import argparse
import http.client
import ssl
import sys
import time
from urllib.parse import urljoin, urlsplit

AGENTS = {
    "desktop": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "android": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    "iphone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
}
MAX_HOPS = 8
UNKNOWN = "zzz-no-such-name-zzz"
BUDGET = 10  # GET /who + /c requests per run
PAUSE = 0.3
FULL_CHAINS = (0, 1, 2, 9)  # desktop full chains: lowercase, capitalised, trailing dot, unknown name (each valid chain costs 2 counted GETs: /who, /c)
FIRST_HOP_ONLY = 2  # variants (lowercase, capitalised) tested for the non-desktop agents
requests_counted = 0

Hop = tuple[str, int, str, int, bytes]  # url, status, content-type, body bytes, body (first 200 kB)


def counts_toward_budget(url: str) -> bool:
    return urlsplit(url).path.startswith(("/who/", "/c/"))


def trampoline_next(url: str, status: int, ctype: str, body: bytes, app: str) -> str | None:
    """200 text/html naming app/who/ (the JS trampoline) -> the lowercased, punctuation-stripped /who/ URL; else None."""
    if not (status == 200 and ctype.startswith("text/html") and body and f"{app}/who/".encode() in body):
        return None
    name = urlsplit(url).path.strip("/").lower().rstrip("./,;:!?")
    return f"https://{app}/who/{name}" if name else None


def fetch(url: str, agent: str) -> tuple[int, dict[str, str], bytes]:
    global requests_counted
    time.sleep(PAUSE)
    requests_counted += counts_toward_budget(url)
    parts = urlsplit(url)
    tls = parts.scheme == "https"
    conn = (http.client.HTTPSConnection(parts.netloc, timeout=8, context=ssl.create_default_context())
            if tls else http.client.HTTPConnection(parts.netloc, timeout=8))
    try:
        target = (parts.path or "/") + ("?" + parts.query if parts.query else "")
        conn.request("GET", target, headers={"User-Agent": agent, "Accept": "text/html,*/*"})
        res = conn.getresponse()
        return res.status, {k.lower(): v for k, v in res.getheaders()}, res.read(200_000)
    finally:
        conn.close()


def get(url: str, agent: str) -> tuple[int, dict[str, str], bytes]:
    status, headers, body = fetch(url, agent)
    if status == 429:  # wait Retry-After once, then retry this hop
        retry = headers.get("retry-after", "")
        time.sleep(min(int(retry) if retry.isdigit() else 5, 30))
        status, headers, body = fetch(url, agent)
    return status, headers, body


def follow(url: str, agent: str, app: str, first_hop_only: bool = False) -> list[Hop]:
    hops: list[Hop] = []
    for _ in range(MAX_HOPS):
        try:
            status, headers, body = get(url, agent)
        except OSError as err:  # includes ssl and timeout errors: a hop that never answered is a failure, not a crash
            hops.append((url, 0, f"ERROR {err}", 0, b""))
            break
        ctype = headers.get("content-type", "")
        hops.append((url, status, ctype, len(body), body))
        if 300 <= status < 400 and "location" in headers:
            hops[-1] = (url, status, ctype + " -> " + headers["location"], len(body), body)
            url = urljoin(url, headers["location"])
            if first_hop_only:
                break
        elif first_hop_only:
            break
        elif nxt := trampoline_next(url, status, ctype, body, app):
            url = nxt
        else:
            break
    return hops


def problems(hops: list[Hop], valid: bool) -> list[str]:
    bad = []
    for url, status, ctype, size, _ in hops[:-1] + hops[-1:]:
        redirect = 300 <= status < 400 and "->" in ctype
        if status == 429:
            bad.append(f"service budget: run the test less often ({url})")
            continue
        if status == 0 or status >= 500:
            bad.append(f"{'no answer' if status == 0 else '5xx'} at {url}")
            continue
        if not redirect and not ctype.strip():
            bad.append(f"no Content-Type at {url} (status {status}, {size} bytes)")
    _, status, ctype, size, body = hops[-1]
    if 300 <= status < 400:
        bad.append(f"redirect chain does not end within {MAX_HOPS} hops")
    elif valid and not (status == 200 and ctype.startswith("text/html") and size > 1000 and b"<!doctype html" in body.lower()):
        bad.append(f"last hop is not a 200 text/html page of > 1000 bytes with <!doctype html (got {status} {ctype!r} {size} bytes)")
    elif not valid and not (status == 404 and ctype.startswith("text/html") and size > 0):
        bad.append(f"unknown name does not end in a 404 text/html with a body (got {status} {ctype!r} {size} bytes)")
    return bad


def first_hop_problems(hops: list[Hop], app: str) -> list[str]:
    """First hop only: a 3xx to <app>/who/<x>, or the 200 text/html trampoline naming it."""
    url, status, ctype, size, body = hops[0]
    if status == 429:
        return [f"service budget: run the test less often ({url})"]
    if 300 <= status < 400 and f"{app}/who/" in ctype:
        return []
    if status == 200 and ctype.startswith("text/html") and size > 0 and f"{app}/who/".encode() in body:
        return []
    return [f"first hop is neither a 3xx to {app}/who/ nor the trampoline page (got {status} {ctype!r} {size} bytes)"]


def variants(name: str, host: str, app: str) -> list[tuple[str, bool]]:
    cap = name[:1].upper() + name[1:]
    return [(u, True) for u in (
        f"https://{host}/{name}", f"https://{host}/{cap}", f"https://{host}/{name}.", f"https://{host}/{name}/", f"https://{host}/{name}?x=1",
        f"https://www.{host}/{name}", f"http://{host}/{name}", f"https://{app}/{name}", f"https://{app}/who/{name}",
    )] + [(f"https://{host}/{UNKNOWN}", False)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="japossert")
    ap.add_argument("--host", default="trustweb.one")
    ap.add_argument("--app", default="app.trustweb.one")
    args = ap.parse_args()
    all_variants = variants(args.name, args.host, args.app)
    jobs = [(all_variants[i][0], "desktop", all_variants[i][1], False) for i in FULL_CHAINS]
    jobs += [(url, agent, valid, True) for agent in AGENTS if agent != "desktop" for url, valid in all_variants[:FIRST_HOP_ONLY]]
    failed = 0
    for url, agent, valid, first_only in jobs:
        hops = follow(url, AGENTS[agent], args.app, first_only)
        bad = first_hop_problems(hops, args.app) if first_only else problems(hops, valid)
        if bad:
            failed += 1
            print(f"FAIL [{agent}] {url}")
            for h in hops:
                print(f"   {h[1]:>3}  {h[3]:>6} B  {h[2] or '(no Content-Type)':<50}  {h[0]}")
            for b in bad:
                print(f"   !! {b}")
    print(f"GET /who + /c requests: {requests_counted} (budget {BUDGET})")
    if requests_counted > BUDGET:
        failed += 1
        print(f"FAIL: over the request budget ({requests_counted} > {BUDGET})")
    print(f"{len(jobs) - failed}/{len(jobs)} chains ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
