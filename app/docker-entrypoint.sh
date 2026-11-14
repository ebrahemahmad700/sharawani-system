#!/bin/sh
# Entrypoint for every docsys container. The first argument chooses the job.
#
#   server   migrate, load fixtures if the database is empty, then serve
#   jobs     the nightly seal, verify, invariants and session purge
#   test     the whole suite against this stack
#   shell    a shell, for poking about
#
# Migrations run here rather than in a separate step because they are idempotent:
# db/migrate.mjs applies only what is pending and records what it applied.

set -e

case "${1:-server}" in
  server)
    echo "docsys: applying migrations"
    node db/migrate.mjs

    echo "docsys: loading fixtures if the database is empty"
    # Never fatal. Fixtures are invented staff for a demonstration, and they
    # refuse a database they cannot prove is disposable, which is exactly right.
    # What is not right is `set -e` then stopping the server from starting.
    #
    # Found by restoring a backup onto a fresh machine and bringing the
    # application up against it, which is the whole point of a drill: the
    # database came back perfectly, the migrations were already up to date, and
    # the web server never started because a step that had correctly declined to
    # do anything returned a non-zero code.
    node db/fixtures.mjs || echo "docsys: fixtures were not loaded; carrying on, which is normal on a real database"

    echo "docsys: starting the web server"
    exec node src/server.mjs
    ;;

  jobs)
    echo "docsys: jobs process starting"
    exec node src/jobs.mjs
    ;;

  test)
    if [ -z "$ALLOW_DESTRUCTIVE_TESTS" ]; then
      echo "docsys: routing.test.mjs writes letters and log rows, so it refuses a"
      echo "        database it cannot prove is disposable. Re-run as:"
      echo "        docker compose run --rm -e ALLOW_DESTRUCTIVE_TESTS=1 app test"
      echo "        Running only the tests that do not write, for now."
      echo
      node test/ku.test.mjs
      node test/ku_sql.test.mjs
      node test/barcode.test.mjs
      node test/http.test.mjs
      node test/screens.test.mjs
      node test/features.test.mjs
      node test/pwa.test.mjs
      node test/qr.test.mjs
      exit 0
    fi

    # Each file is run even if an earlier one failed, and the failures are
    # collected and reported at the end.
    #
    # With `set -e` and a bare list, the first failing file ended the run and
    # every file after it was silently skipped. One flaky check in the reader
    # test hid thirty-one checks in the one after it, and the totals looked like
    # a smaller suite rather than an interrupted one.
    failed=""
    run() {
      if node "test/$1.test.mjs"; then :; else failed="$failed $1"; fi
    }

    TESTS="ku ku_sql barcode routing http screens features storage assistant
           throttle templates scan tray paper desk notify pwa qr board ocr photo
           plots duplicate reply myday fixes scanner audit dates mayor-tools compare stamp"
    for t in $TESTS; do run "$t"; done

    echo
    if [ -n "$failed" ]; then
      echo "docsys: FAILED:$failed"
      exit 1
    fi
    echo "docsys: every test file passed."
    echo
    echo "docsys: guarantees.test.mjs is NOT run here; it empties the activity log."
    echo "docsys: run it deliberately with:"
    echo "        docker compose run --rm -e ALLOW_DESTRUCTIVE_TESTS=1 app node test/guarantees.test.mjs"
    echo
    echo "docsys: backup.test.mjs is not run here either. It needs pg_dump and pg_restore,"
    echo "docsys: which are in the backup container and deliberately not in this one:"
    echo "        docker compose run --rm backup test"
    ;;

  shell)
    exec /bin/sh
    ;;

  *)
    exec "$@"
    ;;
esac
