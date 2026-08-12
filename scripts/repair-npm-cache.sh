#!/bin/sh
set -eu

# Uses an isolated cache for Rakaez. It deliberately does not run
# `npm cache clean`, delete node_modules by hand, or modify the user's global
# npm cache. npm's own documentation recommends verification because the
# cache is self-healing and a clean is normally unnecessary.
repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cache_root="${TMPDIR:-/tmp}/rakaez-npm-cache"

node_major=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$node_major" -ne 24 ]; then
  echo "Rakaez requires Node.js 24. Current version: $(node --version)" >&2
  exit 1
fi

mkdir -p "$cache_root"
npm cache verify --cache "$cache_root"

for project in backend frontend; do
  echo "Installing $project dependencies from the lockfile..."
  (
    cd "$repository_dir/$project"
    npm ci --ignore-scripts --prefer-online --cache "$cache_root" --no-fund
  )
done

echo "Dependency installation completed without touching the global npm cache."
