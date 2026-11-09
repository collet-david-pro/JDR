/** The tab's sessionStorage, or null when the browser refuses it (blocked site data). */
export function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
