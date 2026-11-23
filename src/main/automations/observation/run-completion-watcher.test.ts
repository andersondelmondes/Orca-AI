import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeObservationError } from './run-completion-watcher'

const GENERIC = 'Orca stopped watching this run before it reported completion.'

describe('describeObservationError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a runtime failure code in the run history', () => {
    expect(describeObservationError(new Error('terminal_handle_stale'))).toBe(
      'Orca stopped watching this run before it reported completion (terminal_handle_stale).'
    )
  })

  it.each([
    new Error('connect ECONNREFUSED 127.0.0.1:6768 token=abc123'),
    new Error('Bearer abc.def.ghi'),
    new Error('A'.repeat(80)),
    'terminal_handle_stale',
    null
  ])('does not persist anything that is not a plain code: %s', (error) => {
    expect(describeObservationError(error)).toBe(GENERIC)
  })
})
