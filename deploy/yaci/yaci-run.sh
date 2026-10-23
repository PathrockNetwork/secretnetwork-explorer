#!/usr/bin/env bash
# Run `yaci extract postgres` against $YACI_GRPC into $YACI_DATABASE_URL with
# any extra flags passed through. yaci prints a carriage-return progress bar
# on stdout next to its JSON logs; drop the bar so the journal keeps the logs.
set -uo pipefail
yaci extract postgres "$YACI_GRPC" -p "$YACI_DATABASE_URL" "$@" \
  | tr '\r' '\n' | grep --line-buffered -v -e 'Processing blocks' -e '^[[:space:]]*$'
exit "${PIPESTATUS[0]}"
