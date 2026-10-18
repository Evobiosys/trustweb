#!/usr/bin/env python3
"""Reach-out link chain against production (wave 14): trustweb.one/<name> in every shape a phone produces must end in a real page, never an empty download.

  python3 -I scripts/test_reach_out_chain.py [--name japossert] [--host trustweb.one] [--app app.trustweb.one]

Follows redirects hop by hop (no auto-follow) with three user agents. Asserts per hop: a Content-Type, or a 3xx with Location; never a 5xx.
Last hop of a valid name: 200 text/html, body > 1000 bytes with "<!doctype html". Unknown name: 404 text/html with a non-empty body. Exit 1 with a hop table on failure.
"""
import argparse
import http.client
import ssl
import sys
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlsplit

AGENTS = {
    "desktop": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "android": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    "iphone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
}
MAX_HOPS = 8
UNKNOWN = "zzz-no-such-name-zzz"

Hop = tuple[str, int, str, int, bytes]  # url, status, content-type, body bytes, body (first 200 kB)


def fetch(url: str, agent: str) -> tuple[int, dict[str, str], bytes]:
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


def follow(url: str, agent: str) -> list[Hop]:
    hops: list[Hop] = []
    for _ in range(MAX_HOPS):
        try:
            status, headers, body = fetch(url, agent)
        except OSError as err:  # includes ssl and timeout errors: a hop that never answered is a failure, not a crash
            hops.append((url, 0, f"ERROR {err}", 0, b""))
            break
        hops.append((url, status, headers.get("content-type", ""), len(body), body))
        if not (300 <= status < 400 and "location" in headers):
            break
        hops[-1] = (url, status, headers.get("content-type", "") + " -> " + headers["location"], len(body), body)
        url = urljoin(url, headers["location"])
    return hops


def problems(hops: list[Hop], valid: bool) -> list[str]:
    bad = []
    for url, status, ctype, size, _ in hops[:-1] + hops[-1:]:
        redirect = 300 <= status < 400 and "->" in ctype
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
    jobs = [(url, agent, ua, valid) for url, valid in variants(args.name, args.host, args.app) for agent, ua in AGENTS.items()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda j: follow(j[0], j[2]), jobs))
    failed = 0
    for (url, agent, _, valid), hops in zip(jobs, results):
        bad = problems(hops, valid)
        if bad:
            failed += 1
            print(f"FAIL [{agent}] {url}")
            for h in hops:
                print(f"   {h[1]:>3}  {h[3]:>6} B  {h[2] or '(no Content-Type)':<50}  {h[0]}")
            for b in bad:
                print(f"   !! {b}")
    print(f"{len(jobs) - failed}/{len(jobs)} chains ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
