#!/bin/sh
set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_dir"

if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' >/dev/null; then
  echo "Tracked environment file detected. Remove it from Git before release." >&2
  exit 1
fi

scan_file=$(mktemp "${TMPDIR:-/tmp}/rakaez-secret-scan.XXXXXX")
trap 'rm -f "$scan_file"' EXIT HUP INT TERM
if git grep -IEn -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|sk_(live|test)_[A-Za-z0-9]{20,}|service_role[^A-Za-z0-9_-]*eyJ[A-Za-z0-9_-]{20,}' -- . \
  ':!scripts/security-check.sh' >"$scan_file"; then
  echo "A possible secret or private key is tracked:" >&2
  sed -n '1,20p' "$scan_file" >&2
  exit 1
fi

echo "Tracked-file secret and environment-file checks passed."
