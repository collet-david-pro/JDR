/**
 * Vision of the table (D5): the viewers of a projection screen are the placed tokens that are
 * not hidden and whose definition is assigned to a player in the session, or is a PC (`kind ===
 * 'pc'`) even when nobody is assigned to it. The snapshot gives `viewers`; the client then
 * recomputes them with this same rule (token added / removed, `assignment.set`...).
 */
import type { PlacedToken } from '../../editor/contracts';
import type { SessionState } from '../sessions/state';

export type ViewerSource = Pick<SessionState, 'tokens' | 'definitions' | 'session'>;

/** Visible viewer tokens, in the order of the placed tokens; `floor` limits them to one floor. */
export function tableViewerTokens(state: ViewerSource, floor?: string | null): PlacedToken[] {
  const assigned = new Set(state.session.assignments.map((a) => a.token_id));
  return Object.values(state.tokens).filter((t) => {
    if (t.hidden) return false;
    if (floor !== undefined && floor !== null && t.floor !== floor) return false;
    return assigned.has(t.token_id) || state.definitions[t.token_id]?.kind === 'pc';
  });
}

/** Uids of the viewers (what `ViewOptions.viewers` takes). */
export function tableViewers(state: ViewerSource, floor?: string | null): string[] {
  return tableViewerTokens(state, floor).map((t) => t.uid);
}
