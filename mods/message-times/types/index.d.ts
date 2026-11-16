declare module 'claude-code' {
  interface PluginState {
    'message-times': {
      // Milliseconds since the epoch when each transcript row was first drawn,
      // keyed by row id; 0 when it predates the mod loading.
      sentAt: StateFamily<number | null>
      // The time the relative labels count from, refreshed on a timer.
      now: number | null
    }
  }
}

export {}
