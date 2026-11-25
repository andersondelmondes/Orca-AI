import '../../../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalMessageItem } from '../../../../../../shared/agent-session/journal/agent-session-journal-types'
import { BotItemsStore } from '../../../../../bots/bot-items-store'
import { AgentSessionAttachmentStore } from '../../../../../native-chat/agent-session-attachments/agent-session-attachment-store'
import { agentSessionAttachmentStoreRoot } from '../../../../../native-chat/agent-session-attachments/agent-session-attachment-references'
import { setAgentSessionAttachmentStore } from '../../../../../native-chat/agent-session-attachments/agent-session-attachment-store-registry'
import type { OrchestrationDb } from '../../../../orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'
import type * as RecipientRouting from './recipient-routing'
import {
  DOCS_CHAT,
  journals,
  message,
  RANGER_THREAD,
  setupBotMail
} from './bot-recipient.test-fixture'

vi.mock(
  '../../../../../bots/bot-session-tabs',
  async () => (await import('./bot-recipient.test-fixture')).botSessionTabsMock
)
vi.mock(
  '../../../../../bots/bot-chat-session',
  async () => (await import('./bot-recipient.test-fixture')).botChatSessionMock
)
vi.mock(
  '../../../../../bots/bot-chat-mail-hold',
  async () => (await import('./bot-recipient.test-fixture')).botChatMailHoldMock
)
vi.mock(
  '../../../../../bots/bot-chat-status-line',
  async () => (await import('./bot-recipient.test-fixture')).botChatStatusLineMock
)
vi.mock('./recipient-routing', async (importOriginal) =>
  (await import('./bot-recipient.test-fixture')).recipientRoutingMock(
    await importOriginal<typeof RecipientRouting>()
  )
)
// The item's chat is Docs' Home Chat, live on this host.
vi.mock('../../bots-chats', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  botChatTakingMail: async () => ({ title: null, sessionId: DOCS_CHAT })
}))

describe("an item's files sent to a bot past its pair's quota", () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let send: ReturnType<typeof setupBotMail>['send']
  let root: string
  let uploads: string
  let items: BotItemsStore
  /** The chats each claim kept an upload for. */
  const claims: { sessionId: string; body: AgentJournalMessageItem }[] = []

  beforeEach(() => {
    ;({ db, runtime, send } = setupBotMail(h))
    root = mkdtempSync(join(tmpdir(), 'orca-item-mail-limits-'))
    // The store's own root: only paths under it are uploads its claims and sweep read.
    uploads = agentSessionAttachmentStoreRoot(root)
    mkdirSync(uploads)
    setAgentSessionAttachmentStore(
      new AgentSessionAttachmentStore(uploads, { hasSession: () => true }),
      async (sessionId, body) => {
        claims.push({ sessionId, body })
      }
    )
    claims.length = 0
    items = BotItemsStore.open(':memory:')
    const docsHome = { kind: 'bot', botId: 'docs', chatId: DOCS_CHAT } as const
    items.add(
      {
        ownerBotId: 'docs',
        chatId: DOCS_CHAT,
        source: { kind: 'home', title: null },
        title: 'Install guide',
        status: 'working',
        links: []
      },
      docsHome
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: item mail reads only byNumber and get of the store.
    const remote = items as unknown as ReturnType<typeof runtime.botItems.store>
    vi.spyOn(runtime.botItems, 'store').mockReturnValue(remote)
    vi.spyOn(runtime.botItems, 'owningChat').mockReturnValue({
      id: DOCS_CHAT,
      kind: 'home',
      title: null
    })
    journals[RANGER_THREAD] = [message('ask')]
  })
  afterEach(() => {
    setAgentSessionAttachmentStore(null)
    items.dispose()
    rmSync(root, { recursive: true, force: true })
    h.cleanup()
  })

  /** Ranger's requests to Docs already in this window. */
  const alreadySent = (count: number) => {
    for (let request = 0; request < count; request += 1) {
      db.reserveBotRequest({
        messageId: `msg_earlier_${request}`,
        rootKey: 'earlier',
        fromBotId: 'ranger',
        toBotId: 'docs',
        purpose: 'status',
        depth: 1,
        record: '{}'
      })
    }
  }
  const toDocs = () => db.botRequestsSentWithin({ fromBotId: 'ranger', toBotId: 'docs' }, 10).count
  const mailToDocs = () =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: COUNT over the messages table.
    db.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE to_handle = ?')
      .get(`orca_session_id:${DOCS_CHAT}`) as { n: number }
  const withFile = (subject: string) => {
    const file = join(root, `${subject}.txt`)
    writeFileSync(file, 'release notes draft')
    return { to: 'bot:Docs', type: 'question', subject, item: '1', files: [file] }
  }

  it('copies and claims nothing for a refused send, however often it is tried', async () => {
    alreadySent(30)
    for (const subject of ['notes', 'notes again']) {
      await expect(send(RANGER_THREAD, withFile(subject))).rejects.toMatchObject({
        code: 'bot_request_rate_limit'
      })
    }
    expect(toDocs()).toBe(30)
    expect(mailToDocs().n).toBe(0)
    expect(claims).toEqual([])
    expect(readdirSync(uploads, { withFileTypes: true }).filter((e) => e.isDirectory())).toEqual([])
  })

  it('still copies, claims and sends the files of the send that takes the last place', async () => {
    alreadySent(29)
    await send(RANGER_THREAD, withFile('notes'))
    expect(toDocs()).toBe(30)
    expect(mailToDocs().n).toBe(1)
    expect(claims.map((claim) => claim.sessionId)).toEqual([DOCS_CHAT])
  })
})
