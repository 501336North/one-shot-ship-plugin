# Design: Command logs keep every round

Problem and provenance table: see PLAN.md.

## Decisions (as built)
- `oss-log.sh init <cmd>` appends its banner, so `.oss/logs/current-session/<cmd>.log` holds one banner per run. `grep -c 'OSS Command: /oss:build' build.log` now counts rounds; the IRON LAW text stays as written.
- Size trim (`check_command_log_size`) still keeps the last 1000 lines, but first copies every `OSS Command:` line from the dropped part under the truncation notice, so the banner count survives trimming. The copy tolerates finding no banner (`|| true`) because the script runs under `set -euo pipefail`.
- The log analyzer is unchanged: it has no caller (FOLLOWUPS 2026-10-28).

## Last Updated: 2026-10-28 19:10 CST by /oss:build
