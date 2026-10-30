#!/bin/bash
# Daily backup (the backup service of docker-compose.yml): both databases and the Eitaa gateway's session, into
# /backups/<date>/, each dump checked to be restorable; BACKUP_KEEP_DAYS days are kept. A first backup is taken at
# start when there is none yet. The healthcheck turns unhealthy when the last good backup is older than 26 hours.
#   backup.sh        run on schedule (BACKUP_AT, e.g. 03:30, in TZ)
#   backup.sh now    one backup now (docker compose exec backup /backup.sh now)
set -uo pipefail
export PGPASSWORD="$POSTGRES_PASSWORD"
umask 077

run_once() {
  local stamp dir tmp
  stamp=$(date +%Y%m%d-%H%M)
  dir="/backups/$stamp"
  tmp="$dir.partial"
  rm -rf "$tmp" && mkdir -p "$tmp"
  for db in Transport Tarabari; do
    if ! pg_dump -h postgres -U "$POSTGRES_USER" -d "$db" -Fc -f "$tmp/$db.dump" || ! pg_restore --list "$tmp/$db.dump" >/dev/null; then
      echo "$(date -Is) backup FAILED: $db" >&2
      rm -rf "$tmp"
      return 1
    fi
  done
  # the gateway keeps writing to it (SQLite with its WAL): the copy restores like after a power cut
  tar -czf "$tmp/goomni-data.tgz" -C /goomni-data . || echo "$(date -Is) note: the Eitaa session was not copied" >&2
  mv "$tmp" "$dir"
  chown -R "$BACKUP_UID:$BACKUP_GID" "$dir"
  touch /backups/.last-ok
  echo "$(date -Is) backup $stamp ok ($(du -sh "$dir" | cut -f1))"
  find /backups -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$BACKUP_KEEP_DAYS" -exec rm -rf {} +
}

if [ "${1:-}" = now ]; then
  run_once
  exit
fi

[ -e /backups/.last-ok ] || run_once
while true; do
  now=$(date +%s)
  next=$(date -d "today $BACKUP_AT" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "tomorrow $BACKUP_AT" +%s)
  sleep $((next - now))
  run_once || true
done
