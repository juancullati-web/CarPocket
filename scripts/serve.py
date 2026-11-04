#!/usr/bin/env python3
"""Aperçu local du site. Accessible depuis ce Mac uniquement."""
from __future__ import annotations

import functools
import http.server

import build_index

PORT = 8765
SITE = build_index.ROOT / "site"


def main() -> None:
    build_index.build()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as server:
        print(f"Site disponible sur http://localhost:{PORT}")
        server.serve_forever()


if __name__ == "__main__":
    main()
