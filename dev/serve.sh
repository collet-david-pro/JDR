#!/usr/bin/env bash
# Local PHP development server (option A, see dev/README.md).
#
# PHP_CLI_SERVER_WORKERS is mandatory: without it the built-in server is
# single-process and one open SSE stream (/api/v1/stream) blocks the whole
# site (projet §4.2, §10.3). index.php is passed as the router script because
# `php -S` ignores .htaccess; it serves existing static files itself and
# returns 403 for private folders.
#
# Usage: dev/serve.sh            (PORT=8000 by default)
#        PORT=8080 dev/serve.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8000}"
WORKERS="${PHP_CLI_SERVER_WORKERS:-8}"

if [ ! -f index.php ]; then
  echo "serve.sh: index.php not found in $ROOT" >&2
  exit 1
fi

echo "JDR dev server: http://localhost:${PORT} (${WORKERS} workers, Ctrl+C to stop)"
exec env PHP_CLI_SERVER_WORKERS="$WORKERS" php -S "localhost:${PORT}" index.php
