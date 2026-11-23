import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { activateMobileUiLocale, mobileI18n } from '../../../../i18n/mobile-i18n'
import ru from '../../../../i18n/locales/ru.json'
import type { NativeChatMessage } from '../../../../../../src/shared/native-chat/native-chat-types'
import type {
  AgentMessageSender,
  AgentMessageSource
} from '../../../../../../src/shared/agent-session/journal/agent-session-message-source'
import { MobileAgentMessageOpenContext } from './mobile-agent-message-context'
import { MobileNativeChatAgentMessageCard } from './MobileNativeChatAgentMessageCard'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
}))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios }
}))
vi.mock('lucide-react-native', () => ({ ArrowUpRight: 'ArrowUpRight', Bot: 'Bot' }))
vi.mock('../../preferences/native-chat-text-settings', () => ({
  useNativeChatProseText: () => ({})
}))
vi.mock('../message-content/MobileNativeChatMarkdown', () => ({
  MobileNativeChatMarkdown: () => null
}))
vi.mock('../messages/MobileNativeChatMessageTime', () => ({
  MobileNativeChatMessageTime: () => null
}))
vi.mock('../../../../components/icons/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../../../../components/code-presentation/MobileSourceCopyButton', () => ({
  MobileSourceCopyButton: () => null
}))
// The row draws its words, action and opened details flat, so each reads as text.
vi.mock('../messages/MobileNativeChatEventRow', () => ({
  MobileNativeChatEventName: ({ children }: { children: ReactNode }) => children,
  MobileNativeChatEventRow: (props: {
    label: string
    children: ReactNode
    action?: ReactNode
    details?: ReactNode
  }) =>
    createElement(
      'View',
      { testID: 'row', label: props.label },
      createElement('Text', { testID: 'words' }, props.children),
      props.action,
      createElement('View', { testID: 'details' }, props.details)
    )
}))

let tree: ReactTestRenderer | undefined

beforeAll(async () => {
  mobileI18n.addResourceBundle('ru', 'translation', ru, true, true)
  await activateMobileUiLocale('ru')
})
afterAll(async () => {
  await activateMobileUiLocale('en')
})
afterEach(() => {
  act(() => tree?.unmount())
  tree = undefined
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

function draw(row: NativeChatMessage, open?: () => void) {
  act(() => {
    tree = create(
      createElement(
        MobileAgentMessageOpenContext.Provider,
        { value: open },
        createElement(MobileNativeChatAgentMessageCard, {
          message: row,
          from: row.from as AgentMessageSource,
          fontScale: 1,
          attachments: null
        })
      )
    )
  })
  const root = tree!.root
  const text = (node: ReturnType<typeof root.findByProps>): string =>
    node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('')
  return {
    label: root.findByProps({ testID: 'row' }).props.label as string,
    words: text(root.findByProps({ testID: 'words' })),
    root,
    text
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
    const { label, words } = draw(message(senders, 'follow-up'))
    act(() => tree?.unmount())
    return [label, words]
  })
  expect(cases).toEqual([
    ['Дослано получателю: Сова', 'Дослано получателю: Сова'],
    ['Дослано получателю: @owl', 'Дослано получателю: @owl'],
    ['Дослано получателю: агент', 'Дослано получателю: агент'],
    ['Дослано получателю: агент', 'Дослано получателю: агент'],
    ['Дослано получателю: агент +1', 'Дослано получателю: агент, Сова'],
    ['Дослано получателю: агента', 'Дослано получателю: агента']
  ])
})

it('counts every sender after the first in the spoken label, as desktop does', () => {
  const label = (count: number) =>
    draw(message([sender('Сова'), sender('Лиса'), sender('Ёж')].slice(0, count), 'update')).label
  expect([label(2), label(3)]).toEqual(['Update from Сова +1', 'Update from Сова +2'])
})

it('keeps the sender-form fallback in the open label beside the recipient-form name', () => {
  draw(message([sender(null)], 'follow-up'), () => {})
  const action = tree!.root.findByProps({ accessibilityRole: 'button' })
  expect(action.props.accessibilityLabel).toBe('Открыть агента')
  act(() => tree?.unmount())
  const several = draw(message([sender(null), sender('Сова')], 'follow-up'), () => {})
  const named = several.root.findAllByProps({ accessibilityRole: 'button' })
  expect(named.map((button) => [several.text(button), button.props.accessibilityLabel])).toEqual([
    ['агент', 'Открыть агента'],
    ['Сова', 'Открыть Сова']
  ])
})

it('gives a merged earlier message its own whole lead only when it differs from the row', () => {
  const earlier = (kind: 'follow-up' | 'update') => ({
    ...message([sender('Сова')], kind),
    id: `e-${kind}`
  })
  const { root, text } = draw(
    message([sender('Сова')], 'update', { mergedEvents: [earlier('follow-up'), earlier('update')] })
  )
  const details = root.findByProps({ testID: 'details' })
  expect(details.findAllByType('Text' as never).map(text)).toEqual(['Дополнение отправлено'])
})
