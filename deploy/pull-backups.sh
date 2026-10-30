#!/usr/bin/env bash
# A copy of the server's backups on this machine, so a lost server is not lost data:
#   ./pull-backups.sh user@server [destination]
# destination: ../../backups/server by default. Only new backups travel (rsync).
# SERVER_DIR: the deploy folder on the server (default /opt/trabot/deploy).
set -euo pipefail
cd "$(dirname "$0")"

SERVER=${1:?usage: ./pull-backups.sh user@server [destination]}
DEST=${2:-../../backups/server}
SERVER_DIR=${SERVER_DIR:-/opt/trabot/deploy}
mkdir -p "$DEST" && chmod 700 "$DEST"
# the folder holding the backups is BACKUP_DIR of the server's deploy/.env (data/backups by default)
remote=$(ssh "$SERVER" "cd '$SERVER_DIR' && docker compose config --format json" \
  | python3 -c "import json,sys; print(next(v['source'] for v in json.load(sys.stdin)['services']['backup']['volumes'] if v['target']=='/backups'))")
rsync -a --exclude '*.partial' --exclude '.last-ok' "$SERVER:$remote/" "$DEST/"
echo "backups of $SERVER in $DEST:"
ls -1 "$DEST" | grep '^20' | tail -5
