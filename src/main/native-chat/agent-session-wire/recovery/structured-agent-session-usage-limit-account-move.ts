import type { AgentSessionAccountHome } from '../../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import {
  readSince,
  type UsageLimitAccountScope
} from './structured-agent-session-usage-limit-account-scope'
import { askForRoom, sameAccountHome } from './structured-agent-session-usage-limit-relaunch'

/** How often an account a chat moved to is asked for its first reading since the move. */
const MOVE_READING_ASK_MS = 60_000

type Move = { cut: string; to: AgentSessionAccountHome; at: number }

/** When each chat was first seen continuing on another account than the one its cut hit. Derived
 *  each pass from the attribution; nothing is saved. */
export class UsageLimitAccountMoves {
  private readonly moves = new Map<string, Move>()

  /** `to` is the account the chat continues on now, or null when that is the one `cut` hit. */
  note(id: string, cut: string, to: AgentSessionAccountHome | null, now: number): void {
    const since = this.moves.get(id)
    if (!to) {
      this.moves.delete(id)
    } else if (since?.cut !== cut || !sameAccountHome(since.to, to)) {
      // Each destination counts from when it was chosen, so an older reading of it never releases.
      this.moves.set(id, { cut, to, at: now })
    }
  }

  /** When the chat moved off the account `cut` hit, if it did. */
  at(id: string, cut: string): number | undefined {
    const move = this.moves.get(id)
    return move?.cut === cut ? move.at : undefined
  }

  /** The stop a moved chat publishes waits for the new account's first reading since the move,
   *  and the poller may be idle (unfocused, no viewer): ask for it. */
  askForReading(id: string, scope: UsageLimitAccountScope | undefined): void {
    const move = this.moves.get(id)
    if (move && !readSince(scope?.account, move.at)) {
      askForRoom(scope, MOVE_READING_ASK_MS)
    }
  }

  retain(kept: ReadonlySet<string>): void {
    for (const id of this.moves.keys()) {
      if (!kept.has(id)) {
        this.moves.delete(id)
      }
    }
  }

  clear(): void {
    this.moves.clear()
  }
}
