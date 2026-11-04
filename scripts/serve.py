#!/usr/bin/env python3
"""Aperçu local du site, avec suppression de voitures. Accessible depuis ce Mac uniquement."""
from __future__ import annotations

import functools
import http.server
import json

import build_index
import remove_car

PORT = 8765
ALLOWED_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
SITE = build_index.ROOT / "site"


class Handler(http.server.SimpleHTTPRequestHandler):
    def _answer(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/api/remove":
            self._answer(404, {"error": "Adresse inconnue."})
            return
        # Refuse les demandes venues d'un autre site ouvert dans le navigateur.
        origin = self.headers.get("Origin", "")
        if (
            self.headers.get("Host") not in ALLOWED_HOSTS
            or origin.replace("http://", "", 1) not in ALLOWED_HOSTS
            or self.headers.get("Content-Type") != "application/json"
        ):
            self._answer(403, {"error": "Demande refusée."})
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 4096)
            slug = str(json.loads(self.rfile.read(length))["slug"])
        except (ValueError, KeyError, TypeError):
            self._answer(400, {"error": "Demande illisible."})
            return
        car = remove_car.remove(slug)
        if car:
            self._answer(200, {"removed": car["slug"]})
        else:
            self._answer(404, {"error": "Cette voiture n'existe plus."})


def main() -> None:
    handler = functools.partial(Handler, directory=str(SITE))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as server:
        print(f"Site disponible sur http://localhost:{PORT}")
        server.serve_forever()


if __name__ == "__main__":
    main()
