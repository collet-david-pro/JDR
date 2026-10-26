/**
 * Session code (etapes/P06): 8 characters of ABCDEFGHJKLMNPQRSTUVWXYZ23456789, shown as
 * `K7F2-QM9X`, sent and stored without the dash.
 */
export const SESSION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SESSION_CODE_LENGTH = 8;

/** Upper case, without dash, space or any other separator ("k7f2 qm9x" ⇒ "K7F2QM9X"). */
export function normalizeSessionCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidSessionCode(input: string): boolean {
  const code = normalizeSessionCode(input);
  return (
    code.length === SESSION_CODE_LENGTH && [...code].every((c) => SESSION_CODE_ALPHABET.includes(c))
  );
}

/** `K7F2QM9X` ⇒ `K7F2-QM9X`; also formats an input being typed (dash after 4 characters). */
export function formatSessionCode(input: string): string {
  const code = normalizeSessionCode(input).slice(0, SESSION_CODE_LENGTH);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
