const STALE_HANDLE_RETRY_MS = 1_000
/** Bound recoveries per observation; past it a pane that never comes back fails the run as before. */
const STALE_HANDLE_MAX_RETRIES = 120

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('request_aborted'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('request_aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** A closing or reloading window retires its handles, not the run's pane, so look the pane up again and keep
 *  observing. Quitting closes the window before it aborts the watch; the next start reattaches the run. */
export async function observeAcrossStaleHandles<T>(
  initialHandle: string,
  resolveHandle: () => string | null,
  signal: AbortSignal,
  observe: (handle: string) => Promise<T>
): Promise<T> {
  let handle = initialHandle
  for (let retries = 0; ; retries += 1) {
    try {
      return await observe(handle)
    } catch (error) {
      const stale = error instanceof Error && error.message === 'terminal_handle_stale'
      if (signal.aborted || !stale || retries >= STALE_HANDLE_MAX_RETRIES) {
        throw error
      }
      await sleep(STALE_HANDLE_RETRY_MS, signal)
      handle = resolveHandle() ?? handle
    }
  }
}
