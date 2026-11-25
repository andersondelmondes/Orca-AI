/** The notice an agent question's asker gets when its taker stopped without answering, or never
 *  read it: worded from the taker's last turn, sent by the asker's own route with its outcome. */

import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { QuestionNoticeWriter } from '../../../../orchestration/mailbox/questions/question-reconcile'
import { liveLineageSession } from '../../../../orchestration/mailbox/questions/question-party-facts'
import type { ChatStateReader } from '../../../../../native-chat/agent-session-wire/observations/chat-turn-running'
import {
  BOT_REQUEST_DROP_REASONS,
  type BotRequestNoticeWhy
} from '../../../../../bots/bot-request-view'
import { ensureSenderRecords, tellSender } from './bot-request-sender-notice'
import { readBotTurnInterimStatus } from './bot-turn-interim-status'

type FailureWords = {
  requestId: string
  why: 'failed' | 'failed-continues'
  reason?: string
}

/** Why each chat's latest turn failed, as its failure report worded it: the latest per chat. */
const failures = new Map<string, FailureWords>()

export function noteBotQuestionFailure(sessionId: string, words: FailureWords): void {
  failures.delete(sessionId)
  failures.set(sessionId, words)
  // Only a chat's latest turn is worded, so the oldest chats' words can go.
  for (const oldest of failures.keys()) {
    if (failures.size <= 256) {
      break
    }
    failures.delete(oldest)
  }
}

function isDropReason(why: string): why is (typeof BOT_REQUEST_DROP_REASONS)[number] {
  return BOT_REQUEST_DROP_REASONS.some((reason) => reason === why)
}

type NoticeWords = {
  why: BotRequestNoticeWhy
  reason?: string
  /** The taker's chat and the turn it last ended without failing, whose closing words may say it
   *  queued the question. */
  ended?: { sessionId: string; turnId: string }
}

async function noticeWords(taker: string, readChat?: ChatStateReader): Promise<NoticeWords> {
  if (taker.startsWith('dropped:')) {
    const why = taker.slice('dropped:'.length)
    return { why: isDropReason(why) ? why : 'withdrawn' }
  }
  if (!taker.startsWith('session:')) {
    return { why: 'ended' }
  }
  const live = liveLineageSession(taker.slice('session:'.length))
  // Wording only: a read that fails words the notice generically and never holds it.
  const state = await Promise.resolve()
    .then(() => readChat?.(live))
    .catch(() => null)
  const request = state?.latestRequest
  if (request?.outcome !== 'failure') {
    return request?.kind === 'turn' && request.turnState !== 'running'
      ? { why: 'ended', ended: { sessionId: live, turnId: request.id } }
      : { why: 'ended' }
  }
  // The failure report reads its words after the turn ends; until then the notice says it failed.
  const failure = failures.get(live)
  return failure && failure.requestId === request.id ? failure : { why: 'failed' }
}

export async function botQuestionNotices(
  runtime: OrcaRuntimeService,
  taker: string,
  messageIds: readonly string[],
  readChat?: ChatStateReader
): Promise<QuestionNoticeWriter> {
  const db = runtime.getOrchestrationDb()
  await ensureSenderRecords(
    runtime,
    messageIds.map((id) => db.getMessageById(id))
  )
  const { why, reason, ended } = await noticeWords(taker, readChat)
  // A turn that closed on "accepted, queued" took it: the asker hears that once, and the answer or
  // the next stop without one still counts. The status names no question, so it stands only for a
  // taker holding exactly one.
  const pending =
    ended && messageIds.length === 1
      ? await readBotTurnInterimStatus(runtime, ended.sessionId, ended.turnId).catch(() => null)
      : null
  const outcome = taker.startsWith('dropped:') ? 'dropped' : 'unanswered'
  return ({ messageId }) => {
    const message = db.getMessageById(messageId)
    if (message && pending) {
      return tellSender(runtime, db, message, { pending }) ? 'pending' : 'unverified'
    }
    return !message || tellSender(runtime, db, message, { outcome, why, reason })
      ? 'told'
      : 'unverified'
  }
}
