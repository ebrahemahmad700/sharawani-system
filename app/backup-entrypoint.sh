#!/bin/sh
# Entrypoint for the docsys backup container.
#
#   schedule   take a backup every night and rehearse one every week (the default)
#   now        take one backup and exit
#   rehearse   prove the newest backup restores, and exit
#   restore    put a backup back
#   list       what is in the backup directory
#   check      verify the stored files against their manifests
#   test       the backup test suite, against this stack
#   shell      a shell, for poking about
#
# The scheduler is a shell loop rather than cron. cron in a container needs a
# running daemon, a crontab written at build time, and an environment that cron
# does not inherit, which is three ways to end up with a backup job that looks
# configured and never runs. A loop that prints what it is doing can be read in
# `docker compose logs backup`, which is where somebody will actually look.

set -e

BACKUP_HOUR="${BACKUP_HOUR:-2}"
REHEARSE_DAY="${REHEARSE_DAY:-0}"      # 0 = Sunday, as `date +%w` counts
REHEARSE_HOUR="${REHEARSE_HOUR:-3}"

case "${1:-schedule}" in
  now)      exec node /srv/scripts/backup.mjs ;;
  rehearse) shift; exec node /srv/scripts/rehearse.mjs "$@" ;;
  restore)  shift; exec node /srv/scripts/restore.mjs "$@" ;;
  list)     exec node /srv/scripts/backup.mjs --list ;;
  check)    exec node /srv/scripts/backup.mjs --check ;;
  test)     exec node /srv/test/backup.test.mjs ;;
  shell)    exec /bin/sh ;;

  schedule)
    # No passphrase: say so loudly and keep saying it, rather than exiting.
    #
    # Exiting would make the container restart every few seconds, which fills the
    # log with the same crash and hides the sentence that explains it. Somebody
    # trying this system out for an afternoon should not be stopped; somebody
    # running it for a municipality must not be able to miss that there are no
    # backups. An hourly complaint into `docker compose logs backup` is both.
    if [ -z "${BACKUP_PASSPHRASE}" ]; then
      while true; do
        echo
        echo "docsys backup: NO BACKUPS ARE BEING TAKEN."
        echo "docsys backup: BACKUP_PASSPHRASE is not set in .env, so there is nothing to"
        echo "docsys backup: encrypt them with. A backup of this system is a copy of every"
        echo "docsys backup: letter the municipality holds, and it is meant to leave the"
        echo "docsys backup: building, so it is never written unencrypted."
        echo "docsys backup:"
        echo "docsys backup:   openssl rand -base64 32      then put it in .env"
        echo "docsys backup:   docker compose up -d backup"
        echo "docsys backup:"
        echo "docsys backup: Write the passphrase on paper as well. See RESTORE.md."
        echo
        sleep 3600
      done
    fi

    echo "docsys backup: nightly at ${BACKUP_HOUR}:00, rehearsal on day ${REHEARSE_DAY} at ${REHEARSE_HOUR}:00"
    echo "docsys backup: writing to ${BACKUP_DIR:-/srv/backups}"

    # Take one straight away on a cold start. A container that has just been
    # brought up for the first time, or restarted after a crash, should not wait
    # until two in the morning to have made its first copy of anything.
    if [ "${BACKUP_ON_START:-1}" = "1" ]; then
      node /srv/scripts/backup.mjs || echo "docsys backup: the first backup failed; the schedule continues"
    fi

    last_backup=""
    last_rehearsal=""
    while true; do
      today=$(date +%Y-%m-%d)
      hour=$(date +%-H)
      dow=$(date +%w)

      if [ "$hour" = "$BACKUP_HOUR" ] && [ "$last_backup" != "$today" ]; then
        last_backup="$today"
        node /srv/scripts/backup.mjs || echo "docsys backup: FAILED, see the log row ops.backup_failed"
      fi

      if [ "$dow" = "$REHEARSE_DAY" ] && [ "$hour" = "$REHEARSE_HOUR" ] && [ "$last_rehearsal" != "$today" ]; then
        last_rehearsal="$today"
        node /srv/scripts/rehearse.mjs || echo "docsys backup: the REHEARSAL FAILED; the backups cannot be relied on"
      fi

      sleep 300
    done
    ;;

  *) exec "$@" ;;
esac
