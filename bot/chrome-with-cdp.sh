#!/usr/bin/env bash
# Start Chrome (unstable build) with the CDP remote debugging port enabled.
# It uses its own profile (~/.config/google-chrome-unstable) so it does not
# conflict with a running stable Chrome, and the port is honored because it is
# the first process for that profile.
#
# NOTE: --remote-debugging-port is only honored by the FIRST Chrome process
# for a given profile. If this Chrome is already running, quit it first.
set -euo pipefail

PORT="${CDP_PORT:-9222}"
URL="http://127.0.0.1:${PORT}"
CHROME_BIN="$(command -v google-chrome-unstable || echo /usr/bin/google-chrome-unstable)"

if curl -s --max-time 2 "${URL}/json/version" >/dev/null 2>&1; then
  echo "Chrome is already running with CDP on port ${PORT}."
  exit 0
fi

if pgrep -f "${CHROME_BIN}" >/dev/null 2>&1; then
  echo "Chrome (${CHROME_BIN}) is running WITHOUT the CDP port. Close its"
  echo "windows, then re-run this script."
  exit 1
fi

echo "Launching Chrome (unstable) with remote debugging on port ${PORT}..."
exec "${CHROME_BIN}" --remote-debugging-port="${PORT}" --no-first-run --no-default-browser-check "$@"
