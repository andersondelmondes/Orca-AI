import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../../../orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { BotRequestRecord } from '../../../../../bots/bot-request-view'
import type { ChatStateReader } from '../../../../../native-chat/agent-session-wire/observations/chat-turn-running'
import { testOrcaSessionId } from '../../../../../../shared/agent-session/identity/orca-session-address-test-fixture'
import { botQuestionNotices } from './bot-question-notices'

// What each ended turn closed on, by turn id; read from the chat's journal in the real path.
const closing = vi.hoisted(() => new Map<string, string>())
vi.mock('./bot-turn-interim-status', () => ({
  readBotTurnInterimStatus: async (_runtime: unknown, _session: string, turnId: string) =>
    closing.get(turnId) ?? null
}))
vi.mock('../../../../orchestration/mailbox/questions/question-party-facts', () => ({
  liveLineageSession: (root: string) => root
}))

let db: OrchestrationDb
let runId = ''
beforeEach(() => {
  closing.clear()
  db = new OrchestrationDb(':memory:')
  runId = db.createRun({
    objective: 'asker',
    coordinatorHandle: null,
    coordinatorPaneKey: null,
    coordinatorOrcaSessionId: testOrcaSessionId('00000000-0000-4000-8000-00000000a5c0')
  }).id
})
afterEach(() => db.close())

const runtime = (): OrcaRuntimeService =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the notice writer reads only these runtime members on this path
  ({
    getOrchestrationDb: () => db,
    bots: { list: () => [] },
    ensureStructuredAgentSessionHost: async () => {},
    notifyMessageArrived: () => {}
  }) as never

/** Another agent's question to the review bot's chat, admitted as the orchestration database admits it. */
function question(subject: string): string {
  const record: BotRequestRecord = {
    fromBotId: 'asker',
    fromBotName: 'Asker',
    toBotId: 'reviewer',
    toBotName: 'Reviewer',
    purpose: 'question',
    depth: 1,
    askers: [],
    request: null,
    conversation: null
  }
  const admitted = db.admitBotRequest({
    rootKey: subject,
    fromBotId: 'asker',
    toBotId: 'reviewer',
    purpose: 'question',
    depth: 1,
    record: JSON.stringify(record),
    message: { from: `run:${runId}`, to: 'orca_session_id:chat', subject, type: 'question', runId }
  })
  if (admitted.kind !== 'sent') {
    throw new Error(`not admitted: ${admitted.kind}`)
  }
  return admitted.message.id
}

/** The chat's latest request: the turn `turnId`, ended without failing. */
function endedOn(turnId: string): ChatStateReader {
  const latestRequest = {
    kind: 'turn' as const,
    id: turnId,
    turnState: 'completed' as const,
    outcome: 'success' as const,
    settledAt: 1
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the notice wording reads only latestRequest.
  return async () => ({ latestRequest }) as never
}

const notices = (): string[] =>
  db.db
    .prepare('SELECT body FROM messages WHERE to_handle = ? ORDER BY created_at')
    .all(`run:${runId}`)
    .map((row) => (row && typeof row === 'object' && 'body' in row ? String(row.body) : ''))

it('tells the asker once that a question the bot queued is pending, and keeps it awaiting until a bare stop', async () => {
  const id = question('review this')
  closing.set('turn-a', 'Accepted as item 77; queued FIFO behind two reviews.')
  const decide = async (turnId: string) =>
    (await botQuestionNotices(runtime(), 'session:chat', [id], endedOn(turnId)))({
      messageId: id,
      taker: 'session:chat',
      kind: 'bot'
    })

  expect(await decide('turn-a')).toBe('pending')
  expect(await decide('turn-a')).toBe('pending')
  expect(notices()).toEqual([
    expect.stringContaining(
      'Reviewer took your question and has no answer yet; it said: "Accepted as item 77; queued FIFO behind two reviews."'
    )
  ])
  expect(db.getBotRequestOutcome(id)).toBeNull()

  expect(await decide('turn-b')).toBe('told')
  expect(notices()).toHaveLength(2)
  expect(db.getBotRequestOutcome(id)).toBe('unanswered')
})

it('a queued status stands for no question when the bot holds two', async () => {
  const first = question('first')
  const second = question('second')
  closing.set('turn-a', 'Queued behind item 76; no verdict yet.')
  const write = await botQuestionNotices(
    runtime(),
    'session:chat',
    [first, second],
    endedOn('turn-a')
  )
  expect(write({ messageId: first, taker: 'session:chat', kind: 'bot' })).toBe('told')
  expect(db.getBotRequestOutcome(first)).toBe('unanswered')
})
