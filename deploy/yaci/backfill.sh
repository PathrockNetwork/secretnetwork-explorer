#!/usr/bin/env bash
# Walk yaci history backwards to the node's pruning horizon, one chunk at a
# time. Each pass targets the highest missing block below the live tip, so a
# chunk cut short by a crash or a 429 is simply resumed on the next pass.
# Exits 0 once nothing is missing; a failed chunk exits 1 for systemd to retry.
set -uo pipefail
here="$(dirname "$(readlink -f "$0")")"
chunk="${YACI_BACKFILL_CHUNK:-5000}"
# Stay clear of the live service's in-flight range and of the node pruning
# away the oldest blocks mid-chunk.
tip_margin=200
floor_margin=2000

q() { psql "$YACI_DATABASE_URL" -XAtqc "$1"; }

while true; do
  earliest="$(curl -fsS -m 20 "$SECRET_RPC_URL/status" | sed -n 's/.*"earliest_block_height":"\([0-9]*\)".*/\1/p')"
  [[ -n "$earliest" ]] || { echo "cannot read earliest height from $SECRET_RPC_URL"; exit 1; }
  floor=$((earliest + floor_margin))
  top="$(q "select max(id) from api.blocks_raw")"
  [[ -n "$top" ]] || { echo "no blocks yet; waiting for the live service"; exit 1; }
  top=$((top - tip_margin))
  hole="$(q "select max(g) from generate_series($floor, $top) g left join api.blocks_raw b on b.id = g where b.id is null")"
  if [[ -z "$hole" ]]; then
    echo "backfill complete: $floor..$top"
    exit 0
  fi
  start=$((hole - chunk + 1)); ((start < floor)) && start=$floor
  echo "backfilling $start..$hole (floor $floor)"
  "$here/yaci-run.sh" -s "$start" -e "$hole" -c "${YACI_BACKFILL_CONCURRENCY:-3}" -r 10 -t 6 || exit 1
done
