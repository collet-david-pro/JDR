/** Global application status shown by App.svelte (maintenance screen, update banner). */
class AppStatusStore {
  maintenance = $state(false);
  /** Set when a new service worker version waits; calling it activates and reloads. */
  applyUpdate = $state.raw<(() => void) | null>(null);
}

export const appStatus = new AppStatusStore();
