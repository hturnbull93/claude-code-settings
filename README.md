# claude-code-settings

My personal [Claude Code](https://claude.ai/code) global config.

## Setup

Installed by chezmoi: the dotfiles' `run_bootstrap.sh` clones this repo to `~/claude-code-settings` (or pulls it if it's already there) on every `chezmoi apply`, then symlinks it into `~/.claude`:

| `~/.claude/...` | Repo file |
|---|---|
| `settings.json` | `settings.json` |
| `statusline-command.sh` | `statusline-command.sh` |
| `bin/env-check`, `bin/env-append` | `bin/env-check`, `bin/env-append` |
| `mods/env-guard` | `mods/env-guard` |

Because they're symlinks, edits here are live on that machine at once. Other machines pick them up after a push and their next `chezmoi apply`. The same files are used on every machine, so anything machine-specific (like the status line's role bar) is decided when it runs, by hostname or environment.

`settings.json` loads the mod through `env.CLAUDE_CODE_PLUGIN_DIRS`, so the symlinks above must exist.

### `mods/env-guard`

A Claude Code mod that stops Claude reading dotenv files directly.

- `Read`, `Edit` and `Write` are denied on `.env`, `.env.*` and `*.env`.
- Bash commands that mention a `.env` path are denied.
- Templates are open to the file tools only: `Read`, `Edit` and `Write` may open a basename whose last part is `.example`, `.sample`, `.template` or `.dist` (`.env.example`, `.env.local.sample`), or an `example.env`-style name (`example.env`, `prod.sample.env`), but only if the path, with symlinks followed, lands on a template too. A template-named symlink to `.env`, a dangling one, a path with `.` or `..` segments, a relative path, or a folder that isn't there is denied.
- Bash has no template exemption: any command mentioning a `.env` name is denied, templates included. Any name the guard let through, the shell could rewrite into the real one (`f=.env.example; cat ${f%.example}`), so agents edit templates with the `Edit` tool instead.
- Bash only spots names starting `.env`; `*.env` names like `prod.env` are caught by the file tools but not in commands.
- Allowed instead: `bin/env-check [file...]` (lists keys, comments and set/EMPTY, never values) and `bin/env-append <file> KEY=VALUE` (adds new keys, refuses existing ones, never overwrites).

It is a tripwire against accidents, not a sandbox: obfuscated shell, scripts that read the file, MCP file tools, and the `Grep` and `NotebookEdit` tools are not covered. Names are matched case-sensitively, so on a case-insensitive file system (macOS) `.ENV` gets past it. The file tools follow links only for dotenv-looking names: a symlink with an unrelated name (`notes.txt` pointing at `.env`), or a hard link, gets past it. The link check runs just before the tool opens the file, so a link swapped in between is not seen.

Agent pods on the Fedora server use this same mod: `agent-pod` (in server-ops) mounts this repo's `mods/` folder read-only into each pod, so a change here reaches pods as soon as the host checkout is updated (new Claude sessions pick it up).

Tests: `npm test` (node 23.6+, no install needed).

Dependencies: `bash`, `jq`, `git`, `tput`, `node` (node only needed for the node version display).

## Files

### `settings.json`

Global Claude Code settings with:

- **Model** — defaults to `opus`
- **Notification hook** — plays `Glass.aiff` on permission prompts (falls back to `paplay`, then `canberra-gtk-play`, then terminal bell on Linux)
- **Session timing hooks** — logs session start/stop timestamps to `~/.claude/timing.log`; plays `Ping.aiff` on stop (falls back to `paplay`, then `canberra-gtk-play`, then terminal bell on Linux)
- **Status line** — delegates to `statusline-command.sh` (see below)
- **Voice** — enabled

### `statusline-command.sh`

Renders a two-line status bar at the bottom of the Claude Code UI.

**Line 1**

| Segment | Description |
|---|---|
| Role bar | Fedora server only (host sessions and agent pods), so it's clear which session you're typing into: green `DESK` in `~/desk`, blue `<repo> · <worktree>` in an Orca worktree (`~/orca/workspaces/<repo>/<worktree>`), orange `<dir>` anywhere else (main checkouts, `~/hole`, ...). Not shown on other machines |
| `user@host` | Black on green on the Fedora server, white on black elsewhere |
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
