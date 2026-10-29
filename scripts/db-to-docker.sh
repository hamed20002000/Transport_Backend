#!/usr/bin/env bash
# Copies the local Postgres databases (port 5432) into the docker container (docker-compose.yml), checks that every
# table has the same row count, then points each project's .env at the container (only its DB_PORT line). The local
# databases are left as they are. Run from anywhere; with sudo if your user is not in the docker group:
#   sudo scripts/db-to-docker.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# database → the .env of the project that uses it
declare -A ENV_OF=(
  [Transport]="$PWD/.env"
  [Tarabari]="/home/hamed/ trabari -backend/.env"
)
DATABASES=(Transport Tarabari)

env_value() { grep -E "^\s*$2=" "$1" | tail -1 | cut -d= -f2-; }
DB_USER=$(env_value .env DB_USERNAME)
export PGPASSWORD=$(env_value .env DB_PASSWORD)
LOCAL_PORT=${LOCAL_PORT:-5432}
DOCKER_PORT=${DB_DOCKER_PORT:-5433}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

for db in "${DATABASES[@]}"; do
  [ -f "${ENV_OF[$db]}" ] || { echo "missing ${ENV_OF[$db]}" >&2; exit 1; }
  [ "$(env_value "${ENV_OF[$db]}" DB_USERNAME)" = "$DB_USER" ] && [ "$(env_value "${ENV_OF[$db]}" DB_PASSWORD)" = "$PGPASSWORD" ] \
    || { echo "${ENV_OF[$db]} has another user or password; this script expects the same for every database" >&2; exit 1; }
done

echo "1/5 dumps from localhost:$LOCAL_PORT"
for db in "${DATABASES[@]}"; do
  pg_dump -h localhost -p "$LOCAL_PORT" -U "$DB_USER" -d "$db" -Fc --no-owner --no-privileges -f "$WORK/$db.dump"
  echo "    $db ✓"
done

echo "2/5 starting the container"
docker compose up -d postgres
until [ "$(docker inspect -f '{{.State.Health.Status}}' transport-postgres)" = healthy ]; do sleep 2; done

in_docker() { psql -h localhost -p "$DOCKER_PORT" -U "$DB_USER" "$@"; }

echo "3/5 restore into localhost:$DOCKER_PORT"
for db in "${DATABASES[@]}"; do
  if [ -z "$(in_docker -d postgres -Atc "select 1 from pg_database where datname = '$db'")" ]; then
    in_docker -d postgres -c "create database \"$db\"" >/dev/null
  fi
  if [ "$(in_docker -d "$db" -Atc "select count(*) from pg_tables where schemaname = 'public'")" != 0 ]; then
    echo "«$db» in the container already has tables; nothing restored (remove the volume transport-pgdata to start over)" >&2
    exit 1
  fi
  pg_restore -h localhost -p "$DOCKER_PORT" -U "$DB_USER" -d "$db" --no-owner --no-privileges --exit-on-error "$WORK/$db.dump"
  echo "    $db ✓"
done

echo "4/5 comparing row counts"
count_rows() {
  psql -h localhost -p "$1" -U "$DB_USER" -d "$2" -At -c "
    select string_agg(format('%s.%s=%s', s, t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', s, t), false, true, '')))[1]::text), E'\n' order by s, t)
    from (select schemaname as s, tablename as t from pg_tables where schemaname not in ('pg_catalog', 'information_schema')) tables"
}
for db in "${DATABASES[@]}"; do
  if [ "$(count_rows "$LOCAL_PORT" "$db")" != "$(count_rows "$DOCKER_PORT" "$db")" ]; then
    echo "row counts of «$db» differ; no .env changed" >&2
    diff <(count_rows "$LOCAL_PORT" "$db") <(count_rows "$DOCKER_PORT" "$db") >&2 || true
    exit 1
  fi
  echo "    $db: $(count_rows "$DOCKER_PORT" "$db" | wc -l) tables ✓"
done

echo "5/5 DB_PORT=$DOCKER_PORT in each .env (a copy kept beside it in .env.before-docker)"
for db in "${DATABASES[@]}"; do
  file=${ENV_OF[$db]}
  cp -p "$file" "$(dirname "$file")/.env.before-docker"
  # only the DB_PORT line; written in place, so the file keeps its owner and permissions under sudo
  sed -E "s/^(\s*)DB_PORT=.*/\1DB_PORT=$DOCKER_PORT/" "$file" > "$WORK/env" && cat "$WORK/env" > "$file"
  echo "    $file ✓"
done
echo "done: restart both backends; they now use the container."
