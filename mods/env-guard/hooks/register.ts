import type { Register } from 'claude-code'

// Dotenv-style basenames: .env, .env.local, .env.production, prod.env
const ENV_BASENAME = /^(\.env(\.[^/]*)?|[^/]+\.env)$/

// A .env path token inside a shell command. Preceded by start, whitespace, a
// slash, a quote or a redirect, so `process.env.X` and `.envrc` do not match.
const ENV_IN_COMMAND = /(^|[\s/'"=:<>(])\.env(?![A-Za-z0-9_])/

// The only sanctioned ways in, plain args and no shell operators:
// env-check (keys, comments, set/empty) and env-append (add new keys, never overwrite).
const CHECKER =
  /^(?:~|\$HOME|\/(?:Users|home)\/[^\s/]+)\/\.claude\/bin\/env-(?:check(?: [^\s;&|`$<>()\\]+)*|append(?: [^\s;&|`$<>()\\]+)+)$/

const HINT =
  'Use ~/.claude/bin/env-check [file...] to inspect (keys, comments, set/empty) or ~/.claude/bin/env-append <file> KEY=VALUE to add a new key.'

export const register: Register = on => {
  for (const tool of ['Read', 'Edit', 'Write'] as const) {
    on('tool.call', { tool }, ($, e, next) => {
      const base = e.file_path.split('/').pop() ?? ''

      return ENV_BASENAME.test(base)
        ? { deny: `${$.plugin.name}: ${tool} on ${e.file_path} is blocked. ${HINT}` }
        : next(e)
    }).catch(($, e, next) =>
      next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed.` },
    )
  }

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const command = e.command.trim()

    if (CHECKER.test(command) || !ENV_IN_COMMAND.test(command)) {
      return next(e)
    }

    return { deny: `${$.plugin.name}: this command touches a .env file. ${HINT}` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed.` },
  )
}
