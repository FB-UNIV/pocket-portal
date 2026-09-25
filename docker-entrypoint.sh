#!/bin/sh
# Container entrypoint: apply pending migrations, then run the given command.
#
#   docker run <image>            -> migrate, then start the server
#   docker run <image> migrate    -> migrate only, then exit
#
# The second is what the Helm chart's init container runs, with
# MIGRATE_ON_START=false on the app so it doesn't migrate again.
# Concurrent migrations are safe either way: scripts/migrate.mjs takes a
# Postgres advisory lock.
set -e

# Docker/Kubernetes secrets: VAR_FILE=/run/secrets/x sets VAR from
# that file, the convention the official postgres image uses. Here, so it
# covers the migration step as well as the server. Setting both, or pointing
# at an unreadable file, is an error: a silent fallback would boot with the
# wrong credential. Keep the list in step with the secrets in
# src/lib/config.ts (a test checks).
file_env() {
  var="$1"
  file_var="${var}_FILE"
  eval "value=\${$var:-}"
  eval "file=\${$file_var:-}"
  if [ -n "$file" ]; then
    if [ -n "$value" ]; then
      echo "entrypoint: both $var and $file_var are set; use one" >&2
      exit 1
    fi
    if [ ! -r "$file" ]; then
      echo "entrypoint: $file_var=$file is not readable" >&2
      exit 1
    fi
    export "$var=$(cat "$file")"
  fi
  unset "$file_var"
}

for secret in POCKETID_API_KEY POCKETID_OIDC_CLIENT_SECRET AUTH_SECRET DATABASE_URL METRICS_TOKEN SMTP_PASSWORD; do
  file_env "$secret"
done

run_migrations() {
  echo "entrypoint: applying database migrations"
  node /app/scripts/migrate.mjs
}

if [ "$1" = "migrate" ]; then
  run_migrations
  exit 0
fi

case "${MIGRATE_ON_START:-true}" in
  1 | true | TRUE | True | yes | YES)
    run_migrations
    ;;
  *)
    echo "entrypoint: MIGRATE_ON_START=${MIGRATE_ON_START} — skipping migrations"
    ;;
esac

exec "$@"
