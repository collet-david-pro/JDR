/**
 * Optimistic update (projet.md 18.2): the interface changes before the server answers and
 * goes back visibly when the server refuses. `apply` returns the previous value, given back
 * to `rollback` on failure; the error is re-thrown for the caller (toast, form message).
 */
export async function optimistic<S, R>(
  apply: () => S,
  commit: () => Promise<R>,
  rollback: (previous: S) => void,
): Promise<R> {
  const previous = apply();
  try {
    return await commit();
  } catch (error) {
    rollback(previous);
    throw error;
  }
}

/** Current time as an ISO string (local value until the server answer replaces it). */
export function nowIso(): string {
  return new Date().toISOString();
}
