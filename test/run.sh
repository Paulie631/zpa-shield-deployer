#!/usr/bin/env bash
# Starts the fake backend + Vite, runs the browser test, stops both. Exit code = test result.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Keep real ~/.aws and secrets out of the test by using a throwaway HOME — but keep
# Playwright's browser cache (it lives under the original HOME) reachable.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
export HOME="${E2E_HOME:-$(mktemp -d)}"
mkdir -p "$HOME/.aws"
printf '[profile e2e]\nregion = us-east-1\n' > "$HOME/.aws/config"
printf '[e2e]\naws_access_key_id = AKIAE2E\naws_secret_access_key = x\n' > "$HOME/.aws/credentials"
node "$ROOT/test/fake-backend.js" > "$ROOT/test/out-backend.log" 2>&1 &
BACK=$!
(cd "$ROOT/client" && npx vite --port 3000 --strictPort > "$ROOT/test/out-vite.log" 2>&1) &
FRONT=$!
trap 'kill $BACK $FRONT 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000 && curl -sf -o /dev/null -H "Origin: http://localhost:3000" http://localhost:3001/api/update/version && break; sleep 1; done
rm -f /tmp/zpa-setup.* /tmp/zpa-testapps.* /tmp/zpa-traffic.*
node "$ROOT/test/e2e.js" "$ROOT/test/out"
