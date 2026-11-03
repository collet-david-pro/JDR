/** Global application status shown by App.svelte (maintenance screen, update banner). */
class AppStatusStore {
  maintenance = $state(false);
  /** update.php URL, given by a 503 to an administrator when the database is behind the code. */
  updateUrl = $state<string | null>(null);
  /** Set when a new service worker version waits; calling it activates and reloads. */
  applyUpdate = $state.raw<(() => void) | null>(null);
}

export const appStatus = new AppStatusStore();
