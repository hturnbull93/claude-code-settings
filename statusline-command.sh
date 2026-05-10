#!/usr/bin/env bash
input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // "unknown"')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // empty')
model=$(echo "$input" | jq -r '.model.display_name // empty')
todo_count=$(echo "$input" | jq '[.todos // [] | .[] | select(.status != "completed")] | length')

# Write current session cost into local budget tracker
budget_file="$HOME/.claude/budget.json"
if [ -n "$cost" ] && [ -f "$budget_file" ]; then
  budget_now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  tmp=$(mktemp)
  if jq --arg key "$PPID" --arg c "$cost" --arg now "$budget_now" \
    '.sessions[$key] = {"cost": ($c | tonumber), "last_updated": $now}' \
    "$budget_file" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$budget_file"
  else
    rm -f "$tmp"
  fi
fi

# Shorten home directory to ~
home="$HOME"
cwd_display="${cwd/#$home/\~}"

# Get git branch (no locks)
branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null)

# Get git dirty status (only when in a git repo)
dirty=""
if [ -n "$branch" ]; then
  git_status=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" status --porcelain 2>/dev/null)
  if [ -n "$git_status" ]; then
    dirty=" $(printf '\033[33m*\033[0m')"
  fi
fi

# Helper to print an array of parts joined by " | "
print_line() {
  eval "local _parts=(\"\${$1[@]}\")"
  if [ "${#_parts[@]}" -eq 0 ]; then
    return
  fi
  printf '%s' "${_parts[0]}"
  for part in "${_parts[@]:1}"; do
    printf ' \033[2m|\033[0m %s' "$part"
  done
  printf '\n'
}

# Line 1: user@host, cwd, git branch (with dirty indicator)
line1=()

# user@hostname (mirrors agnoster context segment)
line1+=("$(printf '\033[1m%s@%s\033[0m' "$(whoami)" "$(hostname -s)")")

# CWD
line1+=("$(printf '\033[34m%s\033[0m' "$cwd_display")")

# Git branch with optional dirty indicator
if [ -n "$branch" ]; then
  line1+=("$(printf '\033[32m⎇ %s\033[0m' "$branch")${dirty}")
fi

# Get terminal width, fall back to 80
cols=$(tput cols 2>/dev/null)
if [ -z "$cols" ] || [ "$cols" -eq 0 ] 2>/dev/null; then
  cols=80
fi

# Line 2: context usage, todo count, node version, model
line2=()

# Context usage
if [ -n "$used" ]; then
  used_int=$(printf '%.0f' "$used")
  if [ "$used_int" -ge 80 ]; then
    color='\033[31m'
  elif [ "$used_int" -ge 50 ]; then
    color='\033[33m'
  else
    color='\033[32m'
  fi
  line2+=("$(printf "${color}ctx: %s%%\033[0m" "$used_int")")
fi

# Auto-detect plan type from input JSON:
#   five_hour.used_percentage present → Pro/Max plan → show 5h rate limit
#   cost present and non-empty       → API key billing → show budget sections
#   both present (shouldn't happen)  → prefer 5h mode
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')

if [ -n "$five_pct" ]; then
  # Pro/Max plan: show five-hour rate limit
  five_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
  five_int=$(printf '%.0f' "$five_pct")
  if [ "$five_int" -ge 80 ]; then
    five_color='\033[31m'
  elif [ "$five_int" -ge 50 ]; then
    five_color='\033[33m'
  else
    five_color='\033[32m'
  fi
  five_label="5h: ${five_int}%"
  if [ -n "$five_resets" ]; then
    now=$(date +%s)
    secs_remaining=$((five_resets - now))
    if [ "$secs_remaining" -gt 0 ]; then
      hrs=$((secs_remaining / 3600))
      mins=$(((secs_remaining % 3600) / 60))
      five_label="${five_label} ${hrs}:$(printf '%02d' "$mins")"
    fi
  fi
  line2+=("$(printf "${five_color}%s\033[0m" "$five_label")")
elif [ -n "$cost" ]; then
  # API key billing: show session cost and budget remaining

  cost_display=$(printf '%.4f' "$cost")
  line2+=("$(printf '\033[36m$%s\033[0m' "$cost_display")")

  # Budget remaining (local tracker — set via: ~/.claude/set-budget <amount>)
  if [ -f "$budget_file" ]; then
    baseline_amount=$(jq -r '.baseline.amount // empty' "$budget_file" 2>/dev/null)
    baseline_at=$(jq -r '.baseline.set_at // empty' "$budget_file" 2>/dev/null)
    if [ -n "$baseline_amount" ] && [ -n "$baseline_at" ]; then
      total_spent=$(jq --arg since "$baseline_at" \
        '[.sessions | to_entries[] | select(.value.last_updated >= $since) | .value.cost] | add // 0' \
        "$budget_file" 2>/dev/null)
      if [ -n "$total_spent" ]; then
        remaining=$(awk -v b="$baseline_amount" -v s="$total_spent" 'BEGIN {printf "%.2f", b - s}')
        remaining_pct=$(awk -v b="$baseline_amount" -v s="$total_spent" 'BEGIN {printf "%.0f", ((b - s) / b) * 100}')
        if [ "$remaining_pct" -le 10 ] 2>/dev/null; then
          budget_color='\033[31m'
        elif [ "$remaining_pct" -le 30 ] 2>/dev/null; then
          budget_color='\033[33m'
        else
          budget_color='\033[32m'
        fi
        line2+=("$(printf "${budget_color}\$%s left\033[0m" "$remaining")")
      fi
    fi
  fi
fi

# Todo count
if [ -n "$todo_count" ] && [ "$todo_count" -gt 0 ] 2>/dev/null; then
  line2+=("$(printf '\033[36m\xe2\x9c\x93 %s\033[0m' "$todo_count")")
fi

# Node version (only when package.json exists in cwd)
if [ -f "$cwd/package.json" ]; then
  node_version=$(node --version 2>/dev/null)
  node_version="${node_version#v}"
  if [ -n "$node_version" ]; then
    line2+=("$(printf '\033[2mnode %s\033[0m' "$node_version")")
  fi
fi

# Model
if [ -n "$model" ]; then
  line2+=("$(printf '\033[35m%s\033[0m' "$model")")
fi

# Strip ANSI escape codes and return display length
display_len() { echo -n "$1" | sed 's/\x1b\[[0-9;]*m//g' | wc -c; }

# Calculate display length of line1 as it would appear joined by " | "
line1_display_len() {
  local total=0
  local sep=" | "
  local sep_len=3
  local i
  for i in "${!line1[@]}"; do
    local part_len
    part_len=$(display_len "${line1[$i]}")
    total=$((total + part_len))
    if [ "$i" -gt 0 ]; then
      total=$((total + sep_len))
    fi
  done
  echo "$total"
}

# Move parts from the end of line1 to the start of line2 until line1 fits,
# stopping when only one part remains in line1.
while [ "${#line1[@]}" -gt 1 ]; do
  len=$(line1_display_len)
  if [ "$len" -le "$cols" ]; then
    break
  fi
  # Prepend the last line1 part to line2
  last="${line1[-1]}"
  unset 'line1[-1]'
  line2=("$last" "${line2[@]}")
done

print_line line1
print_line line2
