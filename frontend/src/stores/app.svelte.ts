/** Global application status shown by App.svelte (maintenance screen, update banner). */
class AppStatusStore {
  maintenance = $state(false);
  /** Maintenance flag set by an administrator: the others see the maintenance screen, admins a banner. */
  maintenanceFlag = $state(false);
  /** update.php URL, given by a 503 to an administrator when the database is behind the code. */
  updateUrl = $state<string | null>(null);
  /** Set when a new service worker version waits; calling it activates and reloads. */
  applyUpdate = $state.raw<(() => void) | null>(null);
}

/** Store of the application status (loading, errors, connectivity). */
export const appStatus = new AppStatusStore();
