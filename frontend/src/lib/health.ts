/** GET /api/v1/health payload (lot A contract): {status, db, db_version}. */
export type DbStatus = 'ok' | 'error' | 'not_configured';

export interface HealthData {
  readonly status: string;
  readonly db: DbStatus | string;
  readonly dbVersion: string | null;
}

export function parseHealth(data: unknown): HealthData | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const status = record['status'];
  const db = record['db'];
  const dbVersion = record['db_version'];
  if (typeof status !== 'string' || typeof db !== 'string') return null;
  return {
    status,
    db,
    dbVersion: typeof dbVersion === 'string' && dbVersion !== '' ? dbVersion : null,
  };
}
