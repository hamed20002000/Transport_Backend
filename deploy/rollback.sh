#!/usr/bin/env bash
# Takes the server back to the version that ran before the last ./ship.sh (what ship.sh noted in
# ship-logs/<TAG>.prev on the server): the databases first, then the images.
#   ./rollback.sh deploy@server               undo the migrations that version ran (the newer code still running
#                                             does it: it holds their down()), then the older images; the data stays
#   ./rollback.sh deploy@server --restore-db  instead put the databases back as they were just before that ship (its
#                                             backup); everything written since is gone, so it asks first. A backup
#                                             of the databases as they are now is taken before, just in case
# Run again, it goes one more version back. Cut off half-way, run it again: it goes on from where it stopped.
set -euo pipefail
cd "$(dirname "$0")"

SERVER=${1:?usage: ./rollback.sh deploy@server [--restore-db]}
MODE=${2:-revert}
case "$MODE" in revert|--restore-db) ;; *) echo "unknown option: $MODE" >&2; exit 1 ;; esac
SERVER_DIR=${SERVER_DIR:-/opt/trabot/deploy}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519_vps}
SSH_OPTS="-i $SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=9"

if [ "$MODE" = --restore-db ]; then
  read -r -p "everything written to the databases since that ship (loads, requests, payments, sign-ups) is lost. Type yes: " answer
  [ "$answer" = yes ] || { echo "nothing done"; exit 1; }
fi

ssh $SSH_OPTS "$SERVER" bash -s -- "$(printf '%q' "$SERVER_DIR")" "$MODE" <<'REMOTE'
set -euo pipefail
cd "$1"
mode=$2
current=$(sed -n -E 's/^TAG=//p' .env)
notes="ship-logs/$current.prev"
[ -f "$notes" ] || { echo "no notes for $current ($notes): it was not shipped by ship.sh, so where to go back is unknown" >&2; exit 1; }
# shellcheck disable=SC1090
. "$notes"
[ -n "${PREV_TAG:-}" ] || { echo "$notes names no earlier version" >&2; exit 1; }
docker image inspect "trabot/transport:$PREV_TAG" "trabot/tarabari:$PREV_TAG" "trabot/web:$PREV_TAG" >/dev/null 2>&1 \
  || { echo "the images of $PREV_TAG are gone from the server (docker images 'trabot/*')" >&2; exit 1; }
echo "now: $current → back to: $PREV_TAG"

sql() { # database query
  docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -v ON_ERROR_STOP=1 -tAc \"$2\""
}

revert() { # service database last-migration-to-keep
  local service=$1 db=$2 keep=$3 last tries=0
  if [ -z "$keep" ]; then
    echo "  $db: no migration was noted, nothing undone"
    return
  fi
  # never undo past it: a name not in the table would undo them all
  [ "$(sql "$db" "SELECT count(*) FROM migrations WHERE name = '$keep'")" = 1 ] \
    || { echo "  $db: $keep is not among its migrations; nothing undone" >&2; exit 1; }
  while last=$(sql "$db" 'SELECT name FROM migrations ORDER BY id DESC LIMIT 1'); [ "$last" != "$keep" ]; do
    tries=$((tries + 1))
    [ $tries -le 50 ] || { echo "  $db: still not at $keep after 50" >&2; exit 1; }
    echo "  $db: undoing $last"
    docker compose exec -T "$service" npm run typeorm -- migration:revert >/dev/null
  done
  echo "  $db: at $keep"
}

if [ "$mode" = revert ]; then
  echo "1/2 the migrations of $current"
  revert transport Transport "${TRANSPORT_MIGRATION:-}"
  revert tarabari Tarabari "${TARABARI_MIGRATION:-}"
else
  [ -n "${BACKUP:-}" ] || { echo "$notes names no backup" >&2; exit 1; }
  echo "1/2 the databases from backup $BACKUP"
  docker compose exec -T backup /backup.sh now
  docker compose stop transport tarabari
  for db in Transport Tarabari; do
    # one transaction: if it fails, the database stays as it was
    docker compose exec -T backup sh -c "PGPASSWORD=\"\$POSTGRES_PASSWORD\" pg_restore -h postgres -U \"\$POSTGRES_USER\" -d $db --clean --if-exists --single-transaction --exit-on-error /backups/$BACKUP/$db.dump"
    echo "  $db: restored"
  done
fi

echo "2/2 the images of $PREV_TAG"
sed -i -E "s/^TAG=.*/TAG=$PREV_TAG/" .env
docker compose up -d
docker compose ps
echo "done: back on $PREV_TAG"
REMOTE
