/** Base pack repair (administration): the server works by time-boxed calls, the client repeats them. */

export interface BasePackFailure {
  readonly key: string;
  readonly name: string;
  readonly reason: string;
}

export interface BasePackReport {
  readonly installed: number;
  readonly present: number;
  readonly failed: readonly BasePackFailure[];
  readonly remaining: number;
  readonly total: number;
  readonly complete: boolean;
  readonly busy: boolean;
}

const MAX_CALLS = 60;

/**
 * Calls the server until the pack is complete (or busy / out of calls). Failures are retried on the
 * first call only (`resume` afterwards). Installed counts are cumulated, the rest comes from the last call.
 */
export async function runBasePack(
  call: (resume: boolean) => Promise<BasePackReport>,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<BasePackReport> {
  let installed = 0;
  let last: BasePackReport | null = null;
  for (let i = 0; i < MAX_CALLS; i += 1) {
    const report = await call(i > 0);
    installed += report.installed;
    last = report;
    onProgress(report.total - report.remaining - report.failed.length, report.total);
    if (report.complete || report.busy) break;
  }
  if (last === null) throw new Error('no call');
  const present = Math.max(0, last.total - last.remaining - last.failed.length - installed);
  return { ...last, installed, present };
}
