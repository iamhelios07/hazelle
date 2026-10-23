#!/bin/sh
# Installs or updates Hazelle without Docker, then starts it: the newest release's app in ~/hazelle/app, run by this
# machine's Node 24 or newer, data in ~/hazelle/data (src/server/launch.ts). Termux gets Node from pkg; elsewhere Node
# must be on PATH already. An update replaces app/ alone, so stop the running one first.
#   curl -fsSL https://github.com/jiniill/hazelle/releases/latest/download/install.sh | sh
set -eu
release=https://github.com/jiniill/hazelle/releases/latest/download
root=$HOME/hazelle

major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$major" -lt 24 ]; then
  if [ -n "${TERMUX_VERSION:-}" ]; then
    pkg install -y nodejs-lts
  else
    echo "Node.js 24 이상이 필요해요: https://nodejs.org" >&2
    exit 1
  fi
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fL "$release/hazelle-app.tar.gz" | tar -xz -C "$work"
mkdir -p "$root"
rm -rf "$root/app"
mv "$work/app" "$root/app"
# Run through sh, not by its shebang: Termux has no /bin/sh and rewrites shebangs only where termux-exec is loaded.
cat >"$root/start" <<'EOF'
# Termux: keeps the phone from sleeping the server while the screen is off.
if command -v termux-wake-lock >/dev/null; then termux-wake-lock; fi
exec node "$HOME/hazelle/app/dist/server/launch.js"
EOF
echo "설치했어요. 다음부터는 sh ~/hazelle/start 로 켜요."
exec sh "$root/start"
