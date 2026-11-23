// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n/i18n'
import ru from '@/i18n/locales/ru.json'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import type {
  AgentMessageSender,
  AgentMessageSource
} from '../../../../../../shared/agent-session/journal/agent-session-message-source'
import type * as SenderLabel from '../agent-senders/native-chat-agent-message-sender-label'
import { NativeChatAgentMessageCard } from './NativeChatAgentMessageCard'

const opens = vi.hoisted(() => ({ value: false }))

// The row's own sender names render for real; only the live lookups and heavy leaves are stood in.
vi.mock('../agent-senders/native-chat-agent-message-sender-label', async (actual) => {
  const real = await actual<typeof SenderLabel>()
  const { resolveAgentMessageSenderName } =
    await import('../../../../../../shared/agent-session/view/messages/agent-message-presentation')
  return {
    unnamedSenderLabel: real.unnamedSenderLabel,
    useAgentMessageSenderBot: () => null,
    useAgentMessageSenderName: (sender: AgentMessageSender | undefined) =>
      sender ? resolveAgentMessageSenderName({ localChat: false, snapshotName: sender.name }) : null
  }
})
vi.mock('../agent-senders/native-chat-agent-message-sender-view', () => ({
  useAgentMessageSenderView: () => ({}),
  useAgentMessageSenderOpens: () => opens.value
}))
vi.mock('@/lib/agent-session/open/open-agent-message-sender', () => ({
  openAgentMessageSender: vi.fn()
}))
vi.mock('@/components/sidebar/workspace-card/host/WorktreeHostContextBadge', () => ({
  WorktreeHostContextBadge: () => null
}))
vi.mock('../../media/visuals/native-chat-visual-owner', () => ({
  useNativeChatVisualOwner: () => ({ worktreeId: 'wt' })
}))
vi.mock('../../native-chat-workers-context', () => ({ useNativeChatWorkers: () => [] }))
vi.mock('../../markdown/NativeChatMarkdown', () => ({ NativeChatMarkdown: () => null }))
vi.mock('../../markdown/code/NativeChatCodeBlock', () => ({ NativeChatCodeBlock: () => null }))
vi.mock('../../media/text/NativeChatTextAttachments', () => ({
  NativeChatTextAttachments: () => null
}))
vi.mock('../../media/images/NativeChatImageAttachments', () => ({
  NativeChatImageAttachments: () => null
}))
vi.mock('./NativeChatMessageTimestamp', () => ({ NativeChatMessageTimestamp: () => null }))
vi.mock('../../bot-items/NativeChatBotItemNoteRow', () => ({ ItemChip: () => null }))
vi.mock('@/components/bots/BotAvatar', () => ({
  BotAvatar: () => null,
  CarriedBotAvatar: () => null
}))
vi.mock('@/components/agent/icons/agent-type-icon', () => ({ AgentTypeIcon: () => null }))
// The row draws its lead, names and opened details flat, so each reads as text.
vi.mock('./NativeChatAgentMessageRow', () => ({
  NativeChatAgentMessageRow: (props: {
    lead: string
    spokenNames: string
    names: (spoken: boolean) => React.ReactNode
    details: React.ReactNode
  }) => (
    <div data-spoken={props.spokenNames}>
      <p data-part="line">
        {props.lead} {props.names(true)}
      </p>
      <div data-part="details">{props.details}</div>
    </div>
  )
}))

beforeAll(async () => {
  i18n.addResourceBundle('ru', 'translation', ru, true, true)
  await i18n.changeLanguage('ru')
})
afterAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => {
  cleanup()
  opens.value = false
})

const sender = (name: string | null, address = name ?? 'term_1'): AgentMessageSender => ({
  party: { address, terminalHandle: address, orcaSessionId: null },
  name,
  relation: 'worker'
})
const notice = { message: 'mail-notice', mailbox: 'm', dispatchId: null, messages: [] } as const

function message(
  senders: readonly AgentMessageSender[],
  kind: 'follow-up' | 'update',
  extra: Partial<NativeChatMessage> = {}
): NativeChatMessage {
  return {
    id: `m-${kind}`,
    role: 'user',
    source: 'transcript',
    timestamp: null,
    blocks: [{ type: 'text', text: 'текст' }],
    from: { kind: 'agent', senders, orchestration: kind === 'update' ? notice : null },
    ...(kind === 'follow-up' ? { agentStart: true, agentFollowUp: 'fresh' } : {}),
    ...extra
  } as NativeChatMessage
}

function draw(row: NativeChatMessage) {
  const { container } = render(
    <NativeChatAgentMessageCard
      message={row}
      from={row.from as AgentMessageSource}
      onRefolded={() => {}}
    />
  )
  const root = container.firstElementChild as HTMLElement
  return {
    line: root.querySelector('[data-part="line"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    spoken: root.dataset.spoken,
    details: root.querySelector('[data-part="details"]') as HTMLElement
  }
}

it('names a follow-up recipient by name, handle or the recipient-form fallback', () => {
  const cases = [
    [sender('Сова')],
    [sender('@owl')],
    [],
    [sender(null)],
    [sender(null), sender('Сова')],
    [sender('агента')]
  ].map((senders) => {
    const { line, spoken } = draw(message(senders, 'follow-up'))
    cleanup()
    return [line, spoken]
  })
  expect(cases).toEqual([
    ['Дослано получателю: Сова', 'Сова'],
    ['Дослано получателю: @owl', '@owl'],
    ['Дослано получателю: агент', 'агент'],
    ['Дослано получателю: агент', 'агент'],
    ['Дослано получателю: агент+1', 'агент +1'],
    ['Дослано получателю: агента', 'агента']
  ])
})

it('keeps the sender-form fallback where the row names a sender, and in the open label', () => {
  opens.value = true
  const update = draw(message([sender(null)], 'update'))
  expect(update.spoken).toBe('агента')
  cleanup()
  opens.value = true
  draw(message([sender(null)], 'follow-up'))
  const button = document.querySelector('button')
  expect([button?.textContent, button?.getAttribute('aria-label')]).toEqual([
    'агент',
    'Открыть агента'
  ])
})

it('gives a merged earlier message its own whole lead only when it differs from the row', () => {
  const earlier = (kind: 'follow-up' | 'update') => ({
    ...message([sender('Сова')], kind),
    id: `e-${kind}`
  })
  const leads = (row: NativeChatMessage) =>
    [...draw(row).details.querySelectorAll('p > span')].map((span) => span.textContent)
  expect(
    leads(
      message([sender('Сова')], 'update', {
        mergedEvents: [earlier('follow-up'), earlier('update')]
      })
    )
  ).toEqual(['Дополнение отправлено'])
})
