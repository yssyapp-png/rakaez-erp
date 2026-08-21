#!/bin/sh
set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
environment_file="$repository_dir/backend/.env"
replace_existing=false

if [ "${1:-}" = "--replace" ]; then
  replace_existing=true
elif [ "$#" -gt 0 ]; then
  echo "Usage: npm run configure:supabase [-- --replace]" >&2
  exit 1
fi

if [ -e "$environment_file" ]; then
  if [ "$replace_existing" != true ]; then
    echo "backend/.env already exists; it was not changed." >&2
    echo "Use npm run configure:supabase -- --replace to enter a corrected password." >&2
    exit 1
  fi
fi

node_major=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$node_major" -ne 24 ]; then
  echo "Rakaez requires Node.js 24. Current version: $(node --version)" >&2
  exit 1
fi

if [ ! -t 0 ]; then
  echo "Run this command in an interactive Terminal so the password stays hidden." >&2
  exit 1
fi

printf "Supabase database password (input is hidden): "
saved_tty=$(stty -g)
trap 'stty "$saved_tty" 2>/dev/null || true' EXIT HUP INT TERM
stty -echo
IFS= read -r database_password
stty "$saved_tty"
trap - EXIT HUP INT TERM
printf "\n"

if [ -z "$database_password" ]; then
  echo "Database password cannot be empty." >&2
  exit 1
fi

encoded_password=$(DATABASE_PASSWORD="$database_password" node -e 'process.stdout.write(encodeURIComponent(process.env.DATABASE_PASSWORD))')
unset database_password

jwt_secret=$(openssl rand -hex 48)
security_event_pepper=$(openssl rand -hex 48)
temporary_file=$(mktemp "$repository_dir/backend/.env.tmp.XXXXXX")
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM
umask 077

{
  printf '%s\n' 'PORT=4000'
  printf '%s\n' "DATABASE_URL=postgresql://postgres:${encoded_password}@db.edyavtpnbooeynvqlygt.supabase.co:5432/postgres"
  printf '%s\n' 'NODE_ENV=development'
  printf '%s\n' 'DB_SSL=true'
  printf '%s\n' 'DB_SSL_CA_FILE='
  printf '%s\n' 'DB_POOL_MAX=10'
  printf '%s\n' 'CORS_ALLOWED_ORIGINS=http://localhost:5173'
  printf '%s\n' 'TRUST_PROXY=false'
  printf '%s\n' 'ENFORCE_HTTPS=false'
  printf '%s\n' 'PAYMENTS_ENABLED=false'
  printf '%s\n' 'PUBLIC_REGISTRATION_ENABLED=false'
  printf '%s\n' "JWT_SECRET=${jwt_secret}"
  printf '%s\n' 'JWT_EXPIRES_IN=12h'
  printf '%s\n' 'SESSION_TTL_HOURS=12'
  printf '%s\n' "SECURITY_EVENT_PEPPER=${security_event_pepper}"
  printf '%s\n' 'ZATCA_INTEGRATION_ENABLED=false'
} > "$temporary_file"

if [ -e "$environment_file" ]; then
  backup_file=$(mktemp "$repository_dir/backend/.env.previous.XXXXXX")
  mv "$environment_file" "$backup_file"
  chmod 600 "$backup_file"
  if ! mv "$temporary_file" "$environment_file"; then
    mv "$backup_file" "$environment_file"
    exit 1
  fi
  echo "The previous local environment was retained in a protected ignored backup."
else
  mv "$temporary_file" "$environment_file"
fi
trap - EXIT HUP INT TERM
chmod 600 "$environment_file"

echo "Supabase connection was saved securely in backend/.env."
echo "Payments, public registration, and ZATCA remain disabled."
