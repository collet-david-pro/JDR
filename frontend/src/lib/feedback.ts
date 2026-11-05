/**
 * Feedback links (P13-4c): URL of a pre-filled GitHub issue form (.github/ISSUE_TEMPLATE/bug.yml
 * and idea.yml). Only coarse, non-personal facts are sent: site version, "Firefox · macOS" and
 * the route pattern of the current page ("/games/:id/maps"), never an identifier, invitation
 * code, token, query string or host name.
 */
import { describeUserAgent } from './user-agent';

export type FeedbackKind = 'bug' | 'idea';

/** Issue form file of each kind (field ids: version, browser, page). */
export const FEEDBACK_TEMPLATES: Readonly<Record<FeedbackKind, string>> = {
  bug: 'bug.yml',
  idea: 'idea.yml',
};

const REPO = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const PATTERN = /^\/[A-Za-z0-9:/*?_-]*$/;

/** Repository address when it has the strict form https://github.com/<owner>/<repo>, else null. */
export function validRepoUrl(value: string): string | null {
  const url = value.trim();
  return REPO.test(url) && !/\/\.{1,2}$/.test(url) ? url : null;
}

/**
 * Route pattern to send as the origin page: the pattern declared in the route table
 * (`/games/:id/maps/:mapId/edit`), so no identifier can leak. Anything that is not a plain
 * pattern (no match, odd characters) becomes "inconnue".
 */
export function routePattern(pattern: string | null | undefined): string {
  if (typeof pattern !== 'string' || !PATTERN.test(pattern)) return 'inconnue';
  return pattern;
}

export interface FeedbackInput {
  /** Repository address from the boot data ("" = feedback disabled). */
  readonly repo: string;
  readonly kind: FeedbackKind;
  readonly version: string;
  readonly userAgent: string;
  /** `match.route.path` of the current page. */
  readonly pattern: string | null | undefined;
}

/** New-issue URL with the form pre-filled, or null when no valid repository is set. */
export function feedbackUrl(input: FeedbackInput): string | null {
  const repo = validRepoUrl(input.repo);
  if (repo === null) return null;
  const query = new URLSearchParams({
    template: FEEDBACK_TEMPLATES[input.kind],
    version: input.version,
    browser: describeUserAgent(input.userAgent),
    page: routePattern(input.pattern),
  });
  return `${repo}/issues/new?${query.toString()}`;
}
