#!/usr/bin/env bash
# Isolated server for the Playwright E2E tests (e2e/, projet §21).
#
# 1. copies the deliverable into a temporary folder (never the dev checkout: no config.php,
#    no .git, no frontend/, no e2e/, storage/ reduced to its skeleton);
# 2. (re)creates a blank database (DROP + CREATE: never point it at jdr_dev or jdr_test);
# 3. runs PHP_CLI_SERVER_WORKERS=16 php -S 127.0.0.1:$E2E_PORT index.php in the copy;
# 4. on exit (SIGTERM from Playwright, Ctrl+C), stops PHP, deletes the copy and drops the database.
#
# The front must be built beforehand (cd frontend && npm run build).
#
# Environment (defaults): E2E_PORT (8090), E2E_DB_NAME (jdr_e2e), E2E_DB_HOST (127.0.0.1),
# E2E_DB_PORT (3306), E2E_DB_USER (root), E2E_DB_PASS (empty), E2E_KEEP=1 keeps the copy and
# the database for debugging, E2E_LOG_DIR (e2e/logs) receives the PHP server log.
#
# Usage: dev/e2e-serve.sh            (normally started by e2e/playwright.config.ts)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${E2E_PORT:-8090}"
export E2E_DB_NAME="${E2E_DB_NAME:-jdr_e2e}"
export E2E_DB_HOST="${E2E_DB_HOST:-127.0.0.1}"
export E2E_DB_PORT="${E2E_DB_PORT:-3306}"
export E2E_DB_USER="${E2E_DB_USER:-root}"
export E2E_DB_PASS="${E2E_DB_PASS:-}"
LOG_DIR="${E2E_LOG_DIR:-$ROOT/e2e/logs}"

die() { echo "e2e-serve: $*" >&2; exit 1; }

[[ "$E2E_DB_NAME" =~ ^[a-z][a-z0-9_]{0,63}$ ]] || die "invalid database name '$E2E_DB_NAME'"
case "$E2E_DB_NAME" in
  jdr_dev | jdr_test) die "refusing to wipe '$E2E_DB_NAME' (development/unit test database)" ;;
esac
[[ "$PORT" =~ ^[0-9]+$ ]] || die "invalid port '$PORT'"
[ -f "$ROOT/assets/vite-manifest.json" ] || die "front not built: run 'npm ci && npm run build' in frontend/ first"
command -v rsync > /dev/null || die "rsync is required"

TMP_BASE="${TMPDIR:-/tmp}"
WORK="$(mktemp -d "${TMP_BASE%/}/jdr-e2e-${PORT}.XXXXXX")"
SITE="$WORK/site"
PHP_PID=""

db() { # $1 = SQL statement, run without selecting a database
  E2E_SQL="$1" php -d display_errors=stderr -r '
    $dsn = sprintf("mysql:host=%s;port=%d;charset=utf8mb4", getenv("E2E_DB_HOST"), (int) getenv("E2E_DB_PORT"));
    $pdo = new PDO($dsn, getenv("E2E_DB_USER"), (string) getenv("E2E_DB_PASS"), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec(getenv("E2E_SQL"));
  '
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [ -n "$PHP_PID" ] && kill -0 "$PHP_PID" 2> /dev/null; then
    pkill -TERM -P "$PHP_PID" 2> /dev/null || true # PHP_CLI_SERVER_WORKERS children
    kill -TERM "$PHP_PID" 2> /dev/null || true
    wait "$PHP_PID" 2> /dev/null || true
  fi
  if [ "${E2E_KEEP:-0}" = 1 ]; then
    echo "e2e-serve: kept $SITE and database $E2E_DB_NAME (E2E_KEEP=1)" >&2
  else
    rm -rf "$WORK"
    rm -f "$LOG_DIR/site-$PORT.path"
    db "DROP DATABASE IF EXISTS \`$E2E_DB_NAME\`" || echo "e2e-serve: could not drop $E2E_DB_NAME" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Deliverable only (the shipped tree, see dev/release.mjs), storage/ reduced to its skeleton.
rsync -a \
  --exclude='/.git' --exclude='/.git*' --exclude='/.github' --exclude='/.vscode' --exclude='/.claude' \
  --exclude='/.phpunit.cache' --exclude='/config.php' --exclude='/frontend' --exclude='/e2e' \
  --exclude='/node_modules' --exclude='/tests' --exclude='/dev' --exclude='/docs' --exclude='/dist' \
  --exclude='/etapes' --exclude='/projet.md' \
  --include='/storage/' --include='/storage/**/' --include='/storage/.htaccess' \
  --include='/storage/index.php' --include='/storage/**/.gitkeep' --exclude='/storage/**' \
  "$ROOT/" "$SITE/"
# manifest.json of the copy = the files actually copied (the checkout's one may lag behind
# PHP files changed since the last front build; the admin integrity check reads it).
node "$ROOT/dev/release.mjs" manifest --root "$SITE" > /dev/null

db "DROP DATABASE IF EXISTS \`$E2E_DB_NAME\`"
db "CREATE DATABASE \`$E2E_DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/server-$PORT.log"
# The tests read the copy's location (config.php created, install.php deleted...).
printf '%s\n' "$SITE" > "$LOG_DIR/site-$PORT.path"
echo "e2e-serve: http://127.0.0.1:$PORT  site=$SITE  db=$E2E_DB_NAME  log=$LOG" >&2

cd "$SITE"
PHP_CLI_SERVER_WORKERS=16 php -d display_errors=0 -d log_errors=1 -S "127.0.0.1:$PORT" index.php > "$LOG" 2>&1 &
PHP_PID=$!
wait "$PHP_PID"
