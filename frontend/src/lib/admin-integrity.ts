/** Integrity tool of the administration (projet.md 8.5): slices cumulated, grouping, confirmation rules. */

export type IssueKind =
  | 'quota_mismatch'
  | 'missing_file'
  | 'size_mismatch'
  | 'orphan_file'
  | 'asset_refs_mismatch'
  | 'ref_to_deleted_asset'
  | 'undecodable_chunk'
  | 'undecodable_fog'
  | 'revision_ahead';

/** Display order of the groups. */
export const ISSUE_KINDS: readonly IssueKind[] = [
  'quota_mismatch',
  'size_mismatch',
  'asset_refs_mismatch',
  'revision_ahead',
  'missing_file',
  'orphan_file',
  'undecodable_chunk',
  'undecodable_fog',
  'ref_to_deleted_asset',
];

export interface IntegrityIssue {
  readonly id: string;
  readonly kind: IssueKind;
  readonly severity: 'error' | 'warning';
  readonly subject: {
    readonly type: string;
    readonly id?: number;
    readonly uuid?: string;
    readonly path?: string;
    readonly user_id?: number;
    readonly [key: string]: unknown;
  };
  readonly details: Readonly<Record<string, unknown>>;
  readonly fix: { readonly action: string; readonly destructive: boolean } | null;
}

export interface CheckSlice {
  readonly issues: readonly IntegrityIssue[];
  readonly cursor: string | null;
  readonly progress: { readonly done: number; readonly total: number };
}

export interface FixResult {
  readonly fixed: readonly string[];
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
}

export interface IssueGroup {
  readonly kind: IssueKind;
  readonly issues: readonly IntegrityIssue[];
  /** Issues whose correction loses nothing: can be fixed together. */
  readonly safe: readonly IntegrityIssue[];
}

export interface CheckOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

/**
 * Calls the check until the cursor is null and cumulates the issues. An aborted signal stops between slices
 * (throws the AbortError), nothing is changed on the server by a check.
 */
export async function runCheck(
  fetchSlice: (cursor: string | null) => Promise<CheckSlice>,
  options: CheckOptions = {},
): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const slice = await fetchSlice(cursor);
    for (const issue of slice.issues) {
      if (!seen.has(issue.id)) {
        seen.add(issue.id);
        issues.push(issue);
      }
    }
    options.onProgress?.(slice.progress.done, slice.progress.total);
    cursor = slice.cursor;
  } while (cursor !== null);
  return issues;
}

/** Groups integrity issues by kind. */
export function groupIssues(issues: readonly IntegrityIssue[]): IssueGroup[] {
  const groups: IssueGroup[] = [];
  for (const kind of ISSUE_KINDS) {
    const list = issues.filter((issue) => issue.kind === kind);
    if (list.length === 0) continue;
    groups.push({
      kind,
      issues: list,
      safe: list.filter((issue) => issue.fix !== null && !issue.fix.destructive),
    });
  }
  return groups;
}

/** True when fixing the issue deletes data. */
export function isDestructive(issue: IntegrityIssue): boolean {
  return issue.fix?.destructive === true;
}

/** True when at least one of the issues deletes something: the confirmation is then mandatory. */
export function needsConfirmation(issues: readonly IntegrityIssue[]): boolean {
  return issues.some(isDestructive);
}

/** Body of POST /admin/integrity/fix. `confirm` is only sent for a confirmed destructive correction. */
export function buildFixBody(
  issues: readonly IntegrityIssue[],
  confirmed: boolean,
): {
  issues: { id: string; kind: IssueKind; subject: IntegrityIssue['subject'] }[];
  confirm?: true;
} {
  const body: ReturnType<typeof buildFixBody> = {
    issues: issues.map((issue) => ({ id: issue.id, kind: issue.kind, subject: issue.subject })),
  };
  if (confirmed && needsConfirmation(issues)) return { ...body, confirm: true };
  return body;
}

/** The list without what the server fixed or found already fixed. */
export function withoutFixed(
  issues: readonly IntegrityIssue[],
  result: FixResult,
): IntegrityIssue[] {
  const done = new Set([
    ...result.fixed,
    ...result.skipped.filter((s) => s.reason === 'already_fixed').map((s) => s.id),
  ]);
  return issues.filter((issue) => !done.has(issue.id));
}

/** Parameters of the description message of an issue (admin.integrity.desc.<kind>). */
export function issueParams(issue: IntegrityIssue): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const add = (key: string, value: unknown): void => {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
  };
  for (const [key, value] of Object.entries(issue.subject)) add(key, value);
  for (const [key, value] of Object.entries(issue.details)) add(key, value);
  const assets = issue.details['assets'];
  if (Array.isArray(assets)) out['count'] = assets.length;
  return out;
}
