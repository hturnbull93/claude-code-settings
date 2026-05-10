# claude-code-settings

My personal [Claude Code](https://claude.ai/code) global config.

## Setup

```bash
git clone https://github.com/hturnbull93/claude-code-settings
cp claude-code-settings/settings.json ~/.claude/settings.json
cp claude-code-settings/statusline-command.sh ~/.claude/statusline-command.sh
```

Dependencies: `bash`, `jq`, `git`, `tput`, `node` (node only needed for the node version display).

## Files

### `settings.json`

Global Claude Code settings with:

- **Model** — defaults to `sonnet`
- **Notification hook** — plays `Glass.aiff` on permission prompts (falls back to terminal bell on Linux)
- **Session timing hooks** — logs session start/stop timestamps to `~/.claude/timing.log`; plays `Ping.aiff` on stop (falls back to terminal bell on Linux)
- **Status line** — delegates to `statusline-command.sh` (see below)
- **Voice** — enabled

### `statusline-command.sh`

Renders a two-line status bar at the bottom of the Claude Code UI.

**Line 1**

| Segment | Description |
|---|---|
| Working directory | Current directory with `$HOME` shortened to `~` |
| Git branch | Branch name with a `*` indicator when there are uncommitted changes |

**Line 2**

| Segment | Description |
|---|---|
| `ctx: N%` | Context window usage — green below 50%, yellow 50–79%, red 80%+ |
| `5h: N% H:MM` | 5-hour rate limit usage with time remaining until reset — same colour coding |
| `✓ N` | Count of active (non-completed) todos |
| `node X.Y.Z` | Node.js version — only shown when a `package.json` exists in the working directory |
| Model name | Current Claude model |

When the terminal is too narrow to fit line 1, segments are moved from the right of line 1 to the left of line 2 until it fits.
