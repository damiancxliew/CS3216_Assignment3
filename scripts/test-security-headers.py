"""Exercise the staging proxy locally: python3 scripts/test-security-headers.py /path/to/caddy."""
import http.server
import os
from pathlib import Path
import socket
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(401 if self.path == "/denied" else 404 if self.path == "/missing" else 200)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Powered-By", "test-upstream")
        self.end_headers()
        self.wfile.write(self.path.encode())

    def log_message(self, *_args):
        pass


with http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream) as upstream:
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="pocket-header-test-") as directory:
        config = Path("infra/aws/Caddyfile").read_text()
        # Only replace listeners; test the checked-in routes and headers unchanged.
        config = "{\n admin off\n auto_https off\n}\n" + config
        for original in ("127.0.0.1:3000", "127.0.0.1:3001"):
            config = config.replace(original, f"127.0.0.1:{upstream.server_port}")
        filename = Path(directory) / "Caddyfile"
        filename.write_text(config)
        sentinel = "pocket-test-secret-must-not-appear-in-logs"
        env = {**os.environ, "SITE_DOMAIN": f"http://127.0.0.1:{port}", "POCKET_TEST_SECRET": sentinel,
               "XDG_CONFIG_HOME": directory, "XDG_DATA_HOME": directory}
        with (Path(directory) / "caddy.log").open("w+") as log:
            unit = Path("infra/aws/systemd/caddy.service").read_text()
            command = shlex.split(next(line.removeprefix("ExecStart=") for line in unit.splitlines()
                                       if line.startswith("ExecStart=")))
            command[0] = sys.argv[1]
            command = [str(filename) if arg == "/etc/caddy/Caddyfile" else arg for arg in command]
            process = subprocess.Popen(command,
                                       env=env, stdout=log, stderr=log)
            try:
                for _ in range(100):
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=.1):
                            break
                    except OSError:
                        if process.poll() is not None:
                            log.seek(0)
                            raise RuntimeError(log.read())
                        time.sleep(.05)
                for prefix in ("", "/rest/v1"):
                    for path, status in (("/", 200), ("/denied", 401), ("/missing", 404)):
                        try:
                            response = urllib.request.urlopen(f"http://127.0.0.1:{port}{prefix}{path}", timeout=5)
                        except urllib.error.HTTPError as error:
                            response = error
                        with response:
                            assert response.status == status
                            assert response.read().decode() == path, "Proxy route changed"
                            headers = response.headers
                            assert headers.get("Strict-Transport-Security") == "max-age=86400"
                            assert headers.get("X-Content-Type-Options") == "nosniff"
                            assert headers.get("X-Frame-Options") == "SAMEORIGIN"
                            assert headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
                            assert "frame-ancestors 'self'" in headers.get("Content-Security-Policy", "")
                            assert "object-src 'none'" in headers.get("Content-Security-Policy", "")
                            assert "base-uri 'self'" in headers.get("Content-Security-Policy", "")
                            assert headers.get("X-Powered-By") is None
                log.flush()
                log.seek(0)
                assert sentinel not in log.read(), "Service startup leaked environment secrets"
                print("PASS: app/Data API headers and routing; service does not dump environment secrets")
            finally:
                process.terminate()
                process.wait(timeout=5)
                upstream.shutdown()
