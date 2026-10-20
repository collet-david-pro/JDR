#!/usr/bin/env bash
# Download the PHPUnit 10 PHAR into dev/bin/phpunit.phar (dev only, never shipped).
# Usage: dev/get-phpunit.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="https://phar.phpunit.de/phpunit-10.phar"
DEST="$ROOT/dev/bin/phpunit.phar"

mkdir -p "$(dirname "$DEST")"
TMP="$(mktemp "${DEST}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

curl -fsSL --retry 3 -o "$TMP" "$URL"
chmod 0755 "$TMP"
mv "$TMP" "$DEST"
trap - EXIT

php "$DEST" --version
