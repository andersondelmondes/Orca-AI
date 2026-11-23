import { afterAll, beforeAll, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import ru from '@/i18n/locales/ru.json'
import type { AgentMessageHeading } from '../../../../../../shared/agent-session/view/messages/agent-message-presentation'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import { agentMessageSenderUnavailableText } from '../agent-senders/native-chat-agent-message-sender-target'
import { nativeChatRowCopyText } from '../actions/native-chat-message-copy-text'
import { agentMessageRowFallback, agentMessageRowLead } from './agent-message-row-lead'

beforeAll(async () => {
  i18n.addResourceBundle('ru', 'translation', ru, true, true)
  await i18n.changeLanguage('ru')
})
afterAll(async () => {
  await i18n.changeLanguage('en')
})

const HEADINGS: AgentMessageHeading[] = [
  'started',
  'reopened-worker',
  'followed-up-worker',
  'handed-off',
  'task',
  'worker',
  'generic'
]

it('names a missing follow-up recipient in the recipient form and every other sender in the sender form', () => {
  expect(HEADINGS.map((heading) => agentMessageRowFallback(heading))).toEqual([
    'агента',
    'агента',
    'агент',
    'агента',
    'агента',
    'агента',
    'агента'
  ])
})

it('reads a lead that stands without a name as a whole phrase, never a dangling "to"', () => {
  expect(HEADINGS.map((heading) => agentMessageRowLead(heading, undefined, true))).toEqual([
    'Started',
    'Reopened',
    'Дополнение отправлено',
    'Работа передана',
    'Задача',
    'Обновление',
    'Сообщение'
  ])
  expect(agentMessageRowLead('followed-up-worker')).toBe('Дослано получателю:')
})

it('starts the unavailable sentence with the real name, even one spelled like the fallback', () => {
  const sentence = (name: string | undefined) =>
    agentMessageSenderUnavailableText({ kind: 'replaced' }, name).split(' ')[0]
  expect([sentence('агента'), sentence('Сова'), sentence(undefined)]).toEqual([
    'агента',
    'Сова',
    'Агент'
  ])
})

it('copies a follow-up start with no named worker in the recipient form', () => {
  const message = {
    id: 'm1',
    role: 'user',
    source: 'transcript',
    timestamp: null,
    blocks: [],
    agentStart: true,
    agentFollowUp: 'fresh',
    agentStartItems: [{ uid: 'i1', number: 1, title: 'Отчёт', status: 'open' }],
    from: { kind: 'agent', senders: [], orchestration: null }
  } as unknown as NativeChatMessage
  expect(nativeChatRowCopyText(message)).toBe('Дослано получателю: агент for Отчёт')
})
