/** D11: a text to read stays until the next one, or `clamp(15 s + 60 ms × length, 15 s, 120 s)`. */
export const READ_ALOUD_MIN_MS = 15_000;
/** Maximum read-aloud duration, in milliseconds. */
export const READ_ALOUD_MAX_MS = 120_000;
/** Read-aloud duration per character, in milliseconds. */
export const READ_ALOUD_MS_PER_CHAR = 60;

/** Estimated duration of a read-aloud message, in milliseconds. */
export function readAloudMs(title: string, body: string): number {
  const ms = READ_ALOUD_MIN_MS + READ_ALOUD_MS_PER_CHAR * (title.length + body.length);
  return Math.min(READ_ALOUD_MAX_MS, Math.max(READ_ALOUD_MIN_MS, ms));
}
