import type { Register } from 'claude-code'

// Dotenv-style basenames: .env, .env.local, .env.production, prod.env
const ENV_BASENAME = /^(\.env(\.[^/]*)?|[^/]+\.env)$/

// Templates committed to repos hold placeholder keys, not secrets, so the
// file tools may open them: .env.example, .env.local.sample, example.env, ...
// Bash gets no such exemption (see below).
const TEMPLATE = 'example|sample|template|dist'
const TEMPLATE_BASENAME = new RegExp(
  `^(?:\\.env(?:\\.[^/]+)?\\.(?:${TEMPLATE})|(?!\\.env\\.)(?:[^/]+\\.)?(?:${TEMPLATE})\\.env)$`,
)

// A .env path token inside a shell command. Preceded by start, whitespace, a
// slash, a quote, a redirect or a shell list/brace/alternation character, so
// `process.env.X` and `.envrc` do not match but `{x,.env}` and `(a|.env)` do.
// Templates are denied here too: any string the guard lets through, the shell
// can rewrite into the real name (`f=.env.example; cat ${f%.example}`).
const ENV_IN_COMMAND = /(^|[\s/'"=:<>(){},|;&`])\.env(?![A-Za-z0-9_])/

// The only sanctioned ways in, plain args and no shell operators:
// env-check (keys, comments, set/empty) and env-append (add new keys, never overwrite).
const CHECKER =
  /^(?:~|\$HOME|\/(?:Users|home)\/[^\s/]+)\/\.claude\/bin\/env-(?:check(?: [^\s;&|`$<>()\\]+)*|append(?: [^\s;&|`$<>()\\]+)+)$/

const HINT =
  'Use ~/.claude/bin/env-check [file...] to inspect (keys, comments, set/empty) or ~/.claude/bin/env-append <file> KEY=VALUE to add a new key.'

const TEMPLATE_HINT =
  'Templates (.env.example, .env.sample, ...) can be read and edited with the Read and Edit tools, not from Bash.'

const basename = (path: string) => path.split('/').pop() ?? ''

// The slice of `$.fs` this guard uses.
type Fs = {
  stat: (path: string, options?: { resolve: boolean }) => Promise<{ realPath?: string }>
  list: (path?: string) => Promise<{ name: string }[]>
}

// Where a file tool's path lands once symlinks are followed, or undefined if
// that can't be told for sure. A path with `.`, `..` or empty segments is
// refused outright: the kernel walks `link/..` through the link while a tool
// may normalise it by spelling, so the two could land on different files.
// For a file not there yet (a Write), it is the resolved folder plus the
// name, unless something (a dangling symlink) already holds that name.
const landing = async (fs: Fs, path: string) => {
  if (!path.startsWith('/') || path.split('/').slice(1).some(s => s === '' || s === '.' || s === '..')) {
    return undefined
  }

  // `$.fs.stat` follows links; one leading nowhere answers with no realPath.
  const own = await fs.stat(path, { resolve: true }).catch(() => undefined)

  if (own) {
    return own.realPath
  }

  const cut = path.lastIndexOf('/')
  const folder = path.slice(0, cut) || '/'
  const name = path.slice(cut + 1)
  const dir = await fs.stat(folder, { resolve: true }).catch(() => undefined)

  if (dir?.realPath === undefined) {
    return undefined
  }

  const entries = await fs.list(dir.realPath).catch(() => undefined)

  if (entries === undefined || entries.some(entry => entry.name === name)) {
    return undefined
  }

  return `${dir.realPath.replace(/\/$/, '')}/${name}`
}

const isTemplate = (base: string) => ENV_BASENAME.test(base) && TEMPLATE_BASENAME.test(base)

export const register: Register = on => {
  for (const tool of ['Read', 'Edit', 'Write'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const base = basename(e.file_path)

      if (!ENV_BASENAME.test(base)) {
        return next(e)
      }

      if (isTemplate(base)) {
        const real = await landing($.fs, e.file_path)

        if (real !== undefined && isTemplate(basename(real))) {
          return next(e)
        }

        return {
          deny: `${$.plugin.name}: ${tool} on ${e.file_path} is blocked: it is named like a template but does not resolve to one (a symlink, a missing folder, or \`.\`/\`..\` in the path). Use the plain absolute path of the template file.`,
        }
      }

      return { deny: `${$.plugin.name}: ${tool} on ${e.file_path} is blocked. ${HINT}` }
    }).catch(($, e, next) =>
      next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed.` },
    )
  }

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const command = e.command.trim()

    if (CHECKER.test(command) || !ENV_IN_COMMAND.test(command)) {
      return next(e)
    }

    return { deny: `${$.plugin.name}: this command touches a .env file. ${HINT} ${TEMPLATE_HINT}` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed.` },
  )
}
