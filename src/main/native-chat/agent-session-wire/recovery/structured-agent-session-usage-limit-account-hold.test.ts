import { expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/agent-usage/rate-limits/rate-limit-types'
import type { LegacyAgentSessionAccountHome } from '../../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import type { NativeChatUsageLimitCut } from '../../../../shared/native-chat/transcript/continuation/native-chat-usage-limit-cut'
import { UsageLimitAccountHolds } from './structured-agent-session-usage-limit-account-hold'
import { StructuredAgentSessionUsageLimitContinue } from './structured-agent-session-usage-limit-continue'
import { cancelsCut } from './structured-agent-session-usage-limit-disposition'
import { usageLimitStopWithdrawal } from '../../../../shared/native-chat/transcript/continuation/native-chat-usage-limit-cut'
import { isOptionalUsageLimitContinueCancel } from '../../../../shared/agent-session/lifecycle/stopping/agent-session-usage-limit-continue'

const HIT: LegacyAgentSessionAccountHome = { variable: 'CODEX_HOME', path: '/homes/spent' }
const NEXT: LegacyAgentSessionAccountHome = { variable: 'CODEX_HOME', path: '/homes/next' }
const ENDED = 1_000_000
const SWITCHED = ENDED + 60_000
// A cut whose reset the provider never said.
const CUT: NativeChatUsageLimitCut & { fence: number } = {
  turnItemId: 'turn-1',
  turnEndedAt: ENDED,
  fence: 3
}

function attributed(current: LegacyAgentSessionAccountHome, reading: ProviderRateLimits | null) {
  const holds = new UsageLimitAccountHolds()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: attribution reads only these fields
  const host = {
    store: {
      getRecord: () => ({
        provider: 'codex',
        location: { wslDistro: null },
        launchedAccount: { fence: 3, accountHome: HIT },
        lease: { runtimeFence: 3 }
      })
    },
    launchAccountHome: async () => current,
    usageLimitAutoContinue: {
      accountUsage: async () => ({
        scope: current.path,
        account: { key: current.path, read: () => reading, refresh: () => true }
      })
    }
  } as unknown as Parameters<UsageLimitAccountHolds['attribute']>[1]
  return holds.attribute('chat', host, CUT, SWITCHED).then(() => holds)
}

const reading = (session: { usedPercent: number; resetsAt: number }): ProviderRateLimits => ({
  provider: 'codex',
  session: { ...session, windowMinutes: 300, resetDescription: null },
  weekly: null,
  updatedAt: SWITCHED + 5_000,
  error: null,
  status: 'ok'
})

it('continues an unknown-reset cut once the chat moved to an account with room', async () => {
  const holds = await attributed(NEXT, reading({ usedPercent: 10, resetsAt: SWITCHED + 3_600_000 }))
  const cut = holds.withSwitchReset('chat', CUT)
  expect(cut.resetsAt).toBe(SWITCHED)
  expect(holds.schedulable('chat', cut, SWITCHED + 20_000)).toBe(true)
  expect(holds.ready('chat', { ...cut, resetsAt: SWITCHED }, SWITCHED + 20_000)).toBe(true)
})

it('holds it while the account it moved to is spent too', async () => {
  const spentUntil = SWITCHED + 3_600_000
  const holds = await attributed(NEXT, reading({ usedPercent: 100, resetsAt: spentUntil }))
  const cut = { ...holds.withSwitchReset('chat', CUT), resetsAt: SWITCHED }
  expect(holds.ready('chat', cut, SWITCHED + 20_000)).toBe(false)
  expect(holds.verdict('chat', cut, SWITCHED + 20_000).resetsAt).toBe(spentUntil)
})

it('leaves an unknown reset unknown when the chat never moved accounts', async () => {
  const holds = await attributed(HIT, reading({ usedPercent: 10, resetsAt: SWITCHED + 3_600_000 }))
  const cut = holds.withSwitchReset('chat', CUT)
  expect(cut.resetsAt).toBeUndefined()
  expect(holds.schedulable('chat', cut, SWITCHED + 20_000)).toBe(false)
})

it("a person's Stop withdraws the continue a switch gives an unknown-reset cut", async () => {
  const holds = await attributed(NEXT, reading({ usedPercent: 10, resetsAt: SWITCHED + 3_600_000 }))
  // What the Stop records, read from the journal's own cut (no switch time is kept there).
  const withdrawal = usageLimitStopWithdrawal(CUT)
  expect(isOptionalUsageLimitContinueCancel(withdrawal)).toBe(true)
  expect(cancelsCut(withdrawal, holds.withSwitchReset('chat', CUT))).toBe(true)
})

it('a loaded chat that is not open still follows the account switch in what it publishes', async () => {
  const reset = SWITCHED + 3_600_000
  const cut = { turnItemId: 'turn-1', resetsAt: reset, turnEndedAt: ENDED, chain: 0, fence: 3 }
  const sweep = async (current: LegacyAgentSessionAccountHome) => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the sweep reads only these fields
    const deps = {
      sessions: new Map([['chat', {}]]),
      readSavedCut: async () => null,
      readLoadedCut: async () => cut,
      serialize: (_id: string, run: () => Promise<unknown>) => run(),
      send: async () => ({ ok: true }),
      publish: () => {},
      now: () => SWITCHED,
      host: {
        logger: { warn: () => {} },
        launchAccountHome: async () => current,
        store: {
          hostId: 'host',
          // Nothing is open: no tab, no background chat.
          listVisibleSessionIds: () => [],
          listBackgroundSessionIds: () => [],
          isSessionTabVisible: () => false,
          isSessionInBackground: () => false,
          cancelUsageLimitContinue: async () => {},
          getRecord: () => ({
            provider: 'codex',
            location: { wslDistro: null, executionHostId: 'host', workspaceId: 'ws' },
            launchedAccount: { fence: 3, accountHome: HIT },
            lease: { runtimeFence: 3 }
          })
        },
        usageLimitAutoContinue: { isEnabled: () => true, isWorkspaceAsleep: () => false }
      }
    } as unknown as ConstructorParameters<typeof StructuredAgentSessionUsageLimitContinue>[0]
    const continuer = new StructuredAgentSessionUsageLimitContinue(deps)
    await continuer.tick()
    return continuer.readState('chat', cut)
  }

  // Switched to the account it never hit: the published stop is free from the switch on.
  expect(await sweep(NEXT)).toMatchObject({ resetsAt: reset, continueAt: SWITCHED, state: 'off' })
  // Same account: it still shows the reset it hit.
  const same = await sweep(HIT)
  expect(same).toMatchObject({ resetsAt: reset, state: 'off' })
  expect(same?.continueAt).toBeUndefined()
})
