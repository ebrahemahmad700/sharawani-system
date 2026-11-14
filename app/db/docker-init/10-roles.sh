#!/bin/bash
# Runs once, as the postgres superuser, the first time the data volume is empty.
#
# This is the step Vercel and every other serverless host cannot do. 0000_roles.sql
# creates five roles with different privileges, one of them BYPASSRLS, and that
# needs superuser. The role separation is what stops IT reading letters, so a host
# that only hands you one database user cannot run this system safely.

set -e

: "${DOCSYS_DB_PASSWORD:?DOCSYS_DB_PASSWORD is not set}"

# The password is substituted with sed, so it must not contain | or \ or &.
case "$DOCSYS_DB_PASSWORD" in
  *'|'*|*'\'*|*'&'*)
    echo "DOCSYS_DB_PASSWORD must not contain | \\ or & characters." >&2
    exit 1
    ;;
esac

echo "docsys: creating roles, database and extensions"
sed "s|<set in /etc/docsys/env>|${DOCSYS_DB_PASSWORD}|g" \
    /opt/docsys/0000_roles.sql > /tmp/roles.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -f /tmp/roles.sql
rm -f /tmp/roles.sql
echo "docsys: roles created"
