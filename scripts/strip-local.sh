#!/usr/bin/env bash
# Git clean filter for settings.json: drops machine-specific Orca hooks
# (commands containing ORCA_AGENT_HOOK), then prunes any groups/events left empty.
set -euo pipefail

jq '
  if .hooks then
    .hooks |= (
      with_entries(
        .value |= (
          map(.hooks |= map(select((.command // "") | contains("ORCA_AGENT_HOOK") | not)))
          | map(select(.hooks | length > 0))
        )
      )
      | with_entries(select(.value | length > 0))
    )
    | if .hooks == {} then del(.hooks) else . end
  else . end
'
