import { useAppStore } from '@/store/index'
import { sleepingAgentRecordIndex } from '@/store/terminals/sleep/sleeping-agent-record-index'
import {
  parseLegacyNumericPaneKey,
  parsePaneKey
} from '../../../../../shared/workspace-layout/stable-pane-id'
import type { SleepingAgentSessionRecord } from '../../../../../shared/agent-session/lifecycle/agent-session-resume'
import { getProviderSessionClaimKey } from '../../../../../shared/agent-session/lifecycle/resume/sleeping-record-legacy-pane-key'
import { markSleepingAgentWakeRequest } from './sleeping-agent-wake-request-registry'

export {
  hasSleepingAgentWakeRequest,
  takeSleepingAgentWakeRequest
} from './sleeping-agent-wake-request-registry'

export function getSleepingRecordTabId(record: SleepingAgentSessionRecord): string | null {
  return (
    record.tabId ??
    parsePaneKey(record.paneKey)?.tabId ??
    parseLegacyNumericPaneKey(record.paneKey)?.tabId ??
    null
  )
}

/** Asks the named tabs' sleeping agents to start when their panes mount hidden. Claim keys the host
 * still holds live are skipped: waking such a pane starts a second `--resume` writer (STA-3859). */
export function requestSleepingAgentWakeOnMount(
  worktreeId: string,
  tabIds: readonly string[],
  skipClaimKeys?: ReadonlySet<string>
): void {
  const wanted = new Set(tabIds)
  for (const [, record] of sleepingAgentRecordIndex.entries(
    useAppStore.getState().sleepingAgentSessionsByPaneKey,
    worktreeId
  )) {
    // Explicit sleep stays asleep until its own tab opens; a sibling record's targeted wake must not
    // wake it just because the two share a tab (#11598). A host-claimed record in a mounted tab is
    // the same hazard: its pane reattaches, so a wake mark would only release a duplicate writer.
    if (
      record.restoreOnTabOpenOnly === true ||
      skipClaimKeys?.has(getProviderSessionClaimKey(record)) === true
    ) {
      continue
    }
    const tabId = getSleepingRecordTabId(record)
    if (record.worktreeId === worktreeId && tabId !== null && wanted.has(tabId)) {
      markSleepingAgentWakeRequest(record)
    }
  }
}
