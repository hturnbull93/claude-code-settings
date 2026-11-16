import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderInput } from 'claude-code'

// Milliseconds since the epoch when a row was first drawn; 0 for a row that
// was already in the transcript when the mod loaded (time unknown).
const sentAt = atom({ plugin: 'message-times', key: 'sentAt' } as const, null)

// The time relative labels count from; each refresh redraws every stamped row.
const now = atom({ plugin: 'message-times', key: 'now' } as const, null)

// Where the person is: clock labels are drawn in this zone, not the server's.
// Set from the `timeZone` option (config menu) on each load.
const DEFAULT_TIME_ZONE = 'Europe/London'
let timeZone = DEFAULT_TIME_ZONE

// Rows drawn this soon after load are taken to be old ones redrawn, not new.
const GRACE_MS = 3000
const TICK_MS = 30_000

// Reset on every load, which is what the grace period counts from.
let loadedAt: number | null = null
const pending = new Set<string>()

// Stamps kept across sessions in $.store (message id -> ms), so a resumed or
// continued session still has its times. Newest STORE_LIMIT kept.
const STORE_KEY = 'times'
const STORE_LIMIT = 20_000
const SAVE_DELAY_MS = 2000
let saved = new Map<string, number>()
let isSaveQueued = false

const ago = (ms: number, at: number) => {
  const s = Math.max(0, Math.floor((at - ms) / 1000))

  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

const pad = (n: number) => String(n).padStart(2, '0')

const clock = (ms: number) => {
  try {
    return new Date(ms).toLocaleTimeString('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    const d = new Date(ms)
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  }
}

async function tick($: EngineInterface) {
  const t = await $.clock.now()
  await update($, now, () => t)
}

async function load($: EngineInterface) {
  const raw = await $.store.get(STORE_KEY)
  const entries = raw && typeof raw === 'object' ? Object.entries(raw) : []
  saved = new Map(entries.filter((p): p is [string, number] => typeof p[1] === 'number'))
}

async function save($: EngineInterface) {
  isSaveQueued = false
  const entries = [...saved.entries()].slice(-STORE_LIMIT)
  saved = new Map(entries)
  await $.store.set(STORE_KEY, Object.fromEntries(entries))
}

async function keep($: EngineInterface, requestId: string, value: number) {
  await update($, memberOf(sentAt, { requestId }), prev => prev ?? value)
  pending.delete(requestId)

  if (value !== 0 && !saved.has(requestId)) {
    saved.set(requestId, value)

    if (!isSaveQueued) {
      isSaveQueued = true
      $.clock.after(SAVE_DELAY_MS, () => save($))
    }
  }
}

// The row with its time dimmed to the right, or null for the row alone.
async function withTime($: EngineInterface, e: RenderInput, row: RenderChildren) {
  const stored = await read($, memberOf(sentAt, e))
  const t = await $.clock.now()
  let ms = stored ?? saved.get(e.requestId) ?? null

  if (ms === null) {
    const isOld = loadedAt === null || t - loadedAt < GRACE_MS
    const value = isOld ? 0 : t
    ms = value

    // A render hook may not write state, so the time is kept from a timer.
    if (!pending.has(e.requestId)) {
      pending.add(e.requestId)
      const requestId = e.requestId
      $.clock.after(0, () => keep($, requestId, value))
    }
  }

  if (ms === 0) {
    return null
  }

  // Only fullscreen redraws rows, so only there can "5m ago" stay true.
  const isLive = e.viewport?.isFullscreen === true
  const label = isLive ? ago(ms, Math.max((await read($, now)) ?? t, ms)) : clock(ms)
  const { Box, Text } = $.ui.resolve(e)

  return (
    <Box flexDirection="row">
      <Box flexGrow={1} flexShrink={1}>
        {row}
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        <Text dimColor>{label}</Text>
      </Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  const zone = options.timeZone
  timeZone = typeof zone === 'string' && zone.trim() !== '' ? zone.trim() : DEFAULT_TIME_ZONE

  on('session.start', async ($, e, next) => {
    await load($)
    loadedAt = await $.clock.now()
    await update($, now, () => loadedAt)
    $.clock.every(TICK_MS, () => tick($))
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    const drawn = await withTime($, e, row)
    return drawn ?? row
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const row = await next(e)
    const drawn = await withTime($, e, row)
    return drawn ?? row
  })
}
