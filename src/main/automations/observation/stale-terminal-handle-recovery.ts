const RETRY_MS = 1_000
// Past this a pane that never comes back fails the run as before.
const MAX_RETRIES = 120
// A closed or reloading window rejects with these; neither says the run's pane is gone.
const WINDOW_RETIRED = new Set(['terminal_handle_stale', 'runtime_unavailable'])

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

// Quitting closes the window before it aborts the watch, so a retry must outlast that gap; the next start reattaches.
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
      const retired = error instanceof Error && WINDOW_RETIRED.has(error.message)
      if (signal.aborted || !retired || retries >= MAX_RETRIES) {
        throw error
      }
      await sleep(RETRY_MS, signal)
      handle = resolveHandle() ?? handle
    }
  }
}
