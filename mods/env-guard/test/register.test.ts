// Run with `npm test` from the repo root (node's built-in runner; node 23.6+
// strips the types, so no build step).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from '../hooks/register.ts'

type Handler = (...args: any[]) => any
const handlers = new Map<string, Handler>()

// Minimal stand-in for the mod host: record each tool's handler.
const on = (_event: string, filter: { tool: string }, handler: Handler) => {
  handlers.set(filter.tool, handler)
  return { catch: () => undefined }
}
;(register as any)(on)

const ALLOWED = Symbol('allowed')
const ctx = { plugin: { name: 'env-guard' } }
const run = (tool: string, e: object) => handlers.get(tool)!(ctx, e, () => ALLOWED)

const allowsPath = (tool: string, p: string) => run(tool, { file_path: p }) === ALLOWED
const allowsCommand = (c: string) => run('Bash', { command: c }) === ALLOWED

const FILE_TOOLS = ['Read', 'Edit', 'Write']

const templates = [
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.local.example',
  'example.env',
  'sample.env',
  'template.env',
  'dist.env',
  'prod.example.env',
]

const secrets = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.example.local',
  '.env.examples',
  '.env.example.bak',
  'prod.env',
  'examples.env',
]

test('file tools allow dotenv templates', () => {
  for (const tool of FILE_TOOLS) {
    for (const name of templates) {
      assert.ok(allowsPath(tool, `/repo/${name}`), `${tool} ${name}`)
    }
  }
})

test('file tools still block real dotenv files', () => {
  for (const tool of FILE_TOOLS) {
    for (const name of secrets) {
      assert.ok(!allowsPath(tool, `/repo/${name}`), `${tool} ${name}`)
    }
  }
})

test('file tools leave unrelated files alone', () => {
  for (const name of ['.envrc', 'env.ts', 'README.md', 'environment.example']) {
    assert.ok(allowsPath('Read', `/repo/${name}`), name)
  }
})

test('commands on templates pass', () => {
  for (const c of [
    'cat .env.example',
    "sed -i '/^BACKUP_/,/^$/d' .env.example",
    'sed -n 1,20p apps/api/.env.sample',
    'cp .env.example "$TMPDIR/x"',
    'git diff -- .env.template',
    'grep -n KEY ./.env.dist',
    "cat '.env.example'",
    'cat ".env.local.example"',
    'cat .env.example; echo done',
    'cat .env.example && git add .env.example',
    'cat example.env',
  ]) {
    assert.ok(allowsCommand(c), c)
  }
})

test('commands touching a real dotenv file are denied', () => {
  for (const c of [
    'cat .env',
    'cat .env.local',
    'cat apps/api/.env.production',
    'cp .env.example .env',
    'cat .env.example .env',
    'diff .env .env.example',
    'cat .env.example && cat .env',
    'cat .env.example/../.env',
    'cat .env.example.local',
    'cat .env.examples',
    'cat .env.example.bak',
    // Globs, braces and variables could expand to a real file.
    'cat .env.*',
    'cat .env.example*',
    'cat .env.example?',
    'cat .env.ex*',
    'cat .env{.example,}',
    'cat .env.example{,.local}',
    'cat .env.example$SUFFIX',
    'cat .env.example[a-z]',
    'cat .env.example\\.local',
    'echo X >> .env',
  ]) {
    assert.ok(!allowsCommand(c), c)
  }
})

test('commands without a dotenv path pass', () => {
  for (const c of ['echo $HOME', 'node -e "process.env.X"', 'cat .envrc', 'ls']) {
    assert.ok(allowsCommand(c), c)
  }
})

test('env-check and env-append stay allowed', () => {
  assert.ok(allowsCommand('~/.claude/bin/env-check .env'))
  assert.ok(allowsCommand('~/.claude/bin/env-append .env KEY=1'))
})
