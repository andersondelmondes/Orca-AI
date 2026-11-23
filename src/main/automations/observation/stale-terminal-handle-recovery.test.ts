import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeAcrossStaleHandles } from './stale-terminal-handle-recovery'

const stale = (): Error => new Error('terminal_handle_stale')

describe('observing a run whose terminal handle goes stale', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('looks the pane up again and keeps observing instead of failing the run', async () => {
    const observed: string[] = []
    const result = observeAcrossStaleHandles(
      'h1',
      () => 'h2',
      new AbortController().signal,
      (handle) => {
        observed.push(handle)
        return handle === 'h1' ? Promise.reject(stale()) : Promise.resolve('completed')
      }
    )
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(result).resolves.toBe('completed')
    expect(observed).toEqual(['h1', 'h2'])
  })

  it('ends without a verdict when the app quits while the handle is stale', async () => {
    const controller = new AbortController()
    const result = observeAcrossStaleHandles(
      'h1',
      () => null,
      controller.signal,
      () => Promise.reject(stale())
    )
    const settled = expect(result).rejects.toThrow('request_aborted')
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await settled
  })

  it('does not retry any other failure', async () => {
    let calls = 0
    await expect(
      observeAcrossStaleHandles(
        'h1',
        () => 'h2',
        new AbortController().signal,
        () => {
          calls += 1
          return Promise.reject(new Error('terminal_not_found'))
        }
      )
    ).rejects.toThrow('terminal_not_found')
    expect(calls).toBe(1)
  })

  it('gives up on a pane that never comes back', async () => {
    let calls = 0
    const result = observeAcrossStaleHandles(
      'h1',
      () => null,
      new AbortController().signal,
      () => {
        calls += 1
        return Promise.reject(stale())
      }
    )
    const settled = expect(result).rejects.toThrow('terminal_handle_stale')
    await vi.advanceTimersByTimeAsync(121_000)
    await settled
    expect(calls).toBe(121)
  })
})
