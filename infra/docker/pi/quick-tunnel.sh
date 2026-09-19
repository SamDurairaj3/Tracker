#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
command=${1:-}
admin_email=${2:-}

compose() {
  docker compose --project-directory "$script_dir" --env-file "$script_dir/.env" -f "$script_dir/compose.yaml" "$@"
}

tunnel_compose() {
  docker compose --project-directory "$script_dir" --env-file "$script_dir/.env" \
    -f "$script_dir/compose.yaml" -f "$script_dir/compose.quick-tunnel.yaml" \
    --profile quick-tunnel "$@"
}

case "$command" in
  start)
    [ -n "$admin_email" ] || {
      echo 'Usage: sh ./quick-tunnel.sh start ADMIN_EMAIL' >&2
      exit 2
    }
    [ -s "$script_dir/secrets/postgres_password.txt" ] || {
      echo 'Database secret is missing; run prepare.sh first' >&2
      exit 1
    }
    [ -s "$script_dir/secrets/better_auth_secret.txt" ] || {
      echo 'Authentication secret is missing; run prepare.sh first' >&2
      exit 1
    }
    compose config --quiet
    tunnel_compose config --quiet
    compose ps --status running --services | grep -qx web || {
      echo 'The authenticated web service must be healthy before starting a tunnel' >&2
      exit 1
    }
    compose exec -T postgres psql -U tracker -d tracker -v ON_ERROR_STOP=1 -tAc \
      "SELECT 1 FROM tracker_schema_migrations WHERE name = '0002_better_auth.sql'" | grep -qx 1 || {
      echo 'The Better Auth migration has not been applied' >&2
      exit 1
    }
    compose exec -T postgres psql -U tracker -d tracker -v ON_ERROR_STOP=1 -tAc \
      "SELECT 1 FROM auth_users WHERE banned IS NOT TRUE AND role LIKE '%admin%' LIMIT 1" | grep -qx 1 || {
      echo 'Create an active admin user before starting a tunnel' >&2
      exit 1
    }
    echo 'Verify the administrator login. The password is read privately by the web container.'
    compose run --rm --no-deps web node --import tsx scripts/auth-admin.ts verify-login --email "$admin_email"
    tunnel_compose up -d cloudflared
    echo 'Quick Tunnel started for review. Read its random URL with: sh ./quick-tunnel.sh logs'
    ;;
  status)
    tunnel_compose ps cloudflared
    ;;
  logs)
    tunnel_compose logs --tail 100 cloudflared
    ;;
  stop)
    tunnel_compose stop cloudflared
    tunnel_compose rm -f cloudflared
    echo 'Quick Tunnel stopped.'
    ;;
  *)
    echo 'Usage: sh ./quick-tunnel.sh {start ADMIN_EMAIL|status|logs|stop}' >&2
    exit 2
    ;;
esac
