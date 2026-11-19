import type { Register } from 'claude-code'

// Dotenv-style basenames: .env, .env.local, .env.production, prod.env
const ENV_BASENAME = /^(\.env(\.[^/]*)?|[^/]+\.env)$/

// Templates committed to repos hold placeholder keys, not secrets, so they
// are not blocked: .env.example, .env.local.sample, example.env, ...
const TEMPLATE = 'example|sample|template|dist'
const TEMPLATE_BASENAME = new RegExp(
  `^(?:\\.env(?:\\.[^/]+)?\\.(?:${TEMPLATE})|(?!\\.env\\.)(?:[^/]+\\.)?(?:${TEMPLATE})\\.env)$`,
)

// Every .env path token inside a shell command: `.env` not preceded by a
// letter, digit or underscore (so `process.env.X` does not match, but
// `{x,.env}` and zsh `(a|.env)` do) and not followed by one (so `.envrc`
// does not). Captures the dotted suffix (.local, .example, ...), any quotes
// right after it, and the character after those.
const ENV_IN_COMMAND =
  /(?<![A-Za-z0-9_])\.env(?![A-Za-z0-9_])((?:\.[A-Za-z0-9_-]+)*)(?=(['"]*)(.?))/gs

// A token counts as a template only when its last suffix is a template one
// and the shell word ends there. Quotes are skipped first, because the shell
// joins `".env.example".local` into one word. Anything else after it (glob,
// brace, `$`, `/`, `\`, zsh `<->`) could make the shell reach a real file
// (.env.example* matches .env.example.local), so those stay denied.
const TEMPLATE_SUFFIX = new RegExp(`\\.(?:${TEMPLATE})$`)
const CLEAN_END = /^(?:|[\s;&|)>`])$/

const isTemplateToken = ([, suffix, , after]: RegExpMatchArray) =>
  TEMPLATE_SUFFIX.test(suffix) && CLEAN_END.test(after)

// True if any .env token in the command is not a template.
const touchesRealEnv = (command: string) =>
  [...command.matchAll(ENV_IN_COMMAND)].some(m => !isTemplateToken(m))

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

      return ENV_BASENAME.test(base) && !TEMPLATE_BASENAME.test(base)
        ? { deny: `${$.plugin.name}: ${tool} on ${e.file_path} is blocked. ${HINT}` }
        : next(e)
    }).catch(($, e, next) =>
      next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed.` },
    )
  }

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const command = e.command.trim()

    if (CHECKER.test(command) || !touchesRealEnv(command)) {
      return next(e)
    }

    return { deny: `${$.plugin.name}: this command touches a .env file. ${HINT}` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed.` },
  )
}
