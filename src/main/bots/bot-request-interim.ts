// A bot's turn on a request can end on an interim status ("accepted, queued, verdict follows")
// written in its own chat instead of mailed: that is the request taken and pending, not dropped.
import { BOT_QUIET_MARKER } from '../../shared/bot-quiet-result'

const LINE_MAX = 240
// Only the end of a long turn holds its closing status; verdicts and refusals are read in full.
const TAIL_MAX = 4000

// Only the closing status counts: a full answer that mentions a queue earlier is still an answer.
const CLOSING_SENTENCES = 3

// The bot's own words that this request waits its turn: queued behind something or as a numbered
// item, its place in the queue, or no verdict yet with one to follow. A sentence that only mentions a
// queue ("messages are queued for delivery", "Queued FIFO.") is not one.
const PENDING = new RegExp(
  [
    // Said of this request: opening its clause ("Queued behind…", "…; queued behind…") or after
    // "is"/"was"/"I've", never of other things ("messages queued behind a blocked item…").
    String.raw`(?:^|[;:,]\s*|\b(?:is|was|been|now|it's|i've|we've|i have|we have)\s+)queued (?:fifo )?behind\b`,
    String.raw`\bqueued (?:it |this |your \w+ )?as (?:item |#|number |no\.? ?)\d+`,
    String.raw`\b(?:i|we)(?:'ve| have)? queued (?:it|this|your)\b`,
    String.raw`\b(?:your|this|the) (?:request|review|question|handoff|ask|job) (?:is|was|has been|'s) (?:now )?(?:queued|in (?:the |my )?queue)\b`,
    String.raw`\b(?:\d+(?:st|nd|rd|th)|next) in (?:the |my )?queue\b`,
    String.raw`\bqueue position (?:is )?#?\d+`,
    String.raw`\bno verdict yet\b`,
    String.raw`\bno review (?:has )?started\b`,
    String.raw`\bverdict (?:will )?(?:follows?|to follow)\b`
  ].join('|'),
  'i'
)

// A turn that says it can't take the request is no pending one, even if it also says "queued".
const REFUSAL =
  /\b(?:can(?:no|')t|could(?:n't| not)|won't|will not|unable to) (?:take|do|handle|accept|review|answer|help)\b|\bdeclin(?:e|ed|ing)\b|\brefus(?:e|ed|ing)\b/i

// A verdict written in chat (and not mailed) is an answer the sender never got, not a pending one.
const VERDICT = /\bverdict\s*:|\bnothing (?:is )?queued\b|\b(?:lgtm|approved|changes required)\b/i
// Uppercase only: "tests passed" is no verdict.
const VERDICT_WORD = /\bPASS(?:ED)?\b/

/** The line saying the request is taken and pending, cut for a notice; null for any other ending. */
export function botRequestInterimLine(text: string): string | null {
  // Model prose often writes a typographic apostrophe: "can’t".
  const full = text.trim().replaceAll('\u2019', "'")
  // A verdict or refusal anywhere voids it, even one a long status pushed out of the tail.
  if (
    !full ||
    full === BOT_QUIET_MARKER ||
    REFUSAL.test(full) ||
    VERDICT.test(full) ||
    VERDICT_WORD.test(full)
  ) {
    return null
  }
  const tail = full.slice(-TAIL_MAX)
  const line = tail
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(-CLOSING_SENTENCES)
    .find((part) => PENDING.test(part))
  if (!line) {
    return null
  }
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line
}
