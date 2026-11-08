#!/usr/bin/env python3
"""Repro for finding F-02 of audits/2026-11-08-bff-config-audit.md.

Reproduces the SSE header ordering of bff.py (_chat_ollama) on aiohttp and reads
the raw response headers, so the result does not depend on a browser enforcing
CORS. Verified on aiohttp 3.14.5 — the version reported in versions.txt of the
audited stand. Developer-only; the static site never loads this file.

Run: pip install aiohttp==3.14.5 && python3 audits/evidence/2026-11-08-bff-sse-cors-probe.py
Expected: /bff-pattern -> ACAO absent, /fixed -> ACAO present.
"""
import asyncio

from aiohttp import web

PORT = 8399
ALLOWED = {"http://127.0.0.1:8388", "http://localhost:8388"}


def cors_headers(request, resp):
    origin = request.headers.get("Origin")
    if origin in ALLOWED:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
    return resp


@web.middleware
async def middleware(request, handler):
    resp = await handler(request)
    return cors_headers(request, resp)          # same place as bff.py


async def sse_as_in_bff(request):
    resp = web.StreamResponse(status=200, headers={"Content-Type": "text/event-stream; charset=utf-8"})
    await resp.prepare(request)                 # headers go on the wire here
    origin = request.headers.get("Origin")
    if origin in ALLOWED:
        resp.headers["Access-Control-Allow-Origin"] = origin   # too late
    await resp.write(b"data: [DONE]\n\n")
    await resp.write_eof()
    return resp


async def sse_fixed(request):
    resp = web.StreamResponse(status=200, headers={"Content-Type": "text/event-stream; charset=utf-8"})
    cors_headers(request, resp)                 # before prepare
    await resp.prepare(request)
    await resp.write(b"data: [DONE]\n\n")
    await resp.write_eof()
    return resp


async def probe(path):
    reader, writer = await asyncio.open_connection("127.0.0.1", PORT)
    writer.write((f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n"
                  "Origin: http://127.0.0.1:8388\r\nConnection: close\r\n\r\n").encode())
    await writer.drain()
    raw = (await reader.read()).decode(errors="replace")
    writer.close()
    return raw.split("\r\n\r\n")[0]


async def main():
    app = web.Application(middlewares=[middleware])
    app.router.add_get("/bff-pattern", sse_as_in_bff)
    app.router.add_get("/fixed", sse_fixed)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", PORT)
    await site.start()
    try:
        for path in ("/bff-pattern", "/fixed"):
            headers = await probe(path)
            present = "access-control-allow-origin" in headers.lower()
            print(f"{path}: Access-Control-Allow-Origin present = {present}")
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
