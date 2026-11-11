import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { ApiClient } from './lib/api';
import { readBootConfig, type BootConfig } from './lib/boot';
import { t } from './lib/i18n';
import type { PageComponent } from './lib/page';
import { setServices } from './lib/services';
import { sessionStore } from './lib/session-store';
import { registerServiceWorker } from './lib/sw-register';
import {
  autoReloadRoute,
  claimReload,
  isEditing,
  watchVersion,
  type ServedVersion,
} from './lib/version-watch';
import { Router } from './router';
import { routes } from './routes';
import { requiresLogin, loginPath } from './lib/guard';
import { appStatus } from './stores/app.svelte';
import { AuthStore } from './stores/auth.svelte';
import { prefs } from './stores/prefs.svelte';
import { tour } from './stores/tour.svelte';

/** localStorage, or null when the browser refuses it (private mode, sandbox). */
function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function start(): void {
  // Theme first, to limit the flash before the first render.
  prefs.init(window);

  const target = document.getElementById('app');
  if (target === null) throw new Error('#app element is missing');

  let boot: BootConfig;
  try {
    boot = readBootConfig(document, import.meta.env.DEV);
  } catch (error) {
    console.error(error);
    target.textContent = t('app.boot_error');
    return;
  }

  const router = new Router<PageComponent>({
    routes,
    mode: boot.routingMode,
    basePath: boot.basePath,
    window,
    document,
  });

  const api = new ApiClient({
    baseUrl: boot.apiBase,
    csrfToken: boot.csrf,
    onUnauthorized: () => {
      // Session expired or revoked: forget the user, then back to the login page when the
      // current page needs an account (public pages stay where they are).
      auth.handleUnauthorized();
      const { location, match } = router.state;
      if (match !== null && requiresLogin(match.route.access)) {
        router.navigate(loginPath(location), { replace: true });
      }
    },
    onMaintenance: (error) => {
      appStatus.maintenance = true;
      appStatus.updateUrl = error.fields['update_url'] ?? null;
    },
    refreshCsrf: (): Promise<void> => auth.bootstrap(),
  });

  appStatus.maintenanceFlag = boot.maintenance;
  const auth: AuthStore = new AuthStore(api, prefs);
  setServices({ boot, api, router, auth });
  tour.connect(
    {
      userId: () => auth.user?.id ?? null,
      remote: () => auth.prefs['tours'],
      save: (value) => void auth.savePref('tours', value),
    },
    deviceStorage(),
  );
  router.start();
  mount(App, { target });
  void auth.bootstrap();

  if (import.meta.env.PROD) {
    registerServiceWorker(boot.basePath, (activate) => {
      appStatus.applyUpdate = activate;
    });
  }

  watchVersion({
    current: boot.build,
    fetchVersion: async () => (await api.get<ServedVersion>('/version')).data,
    onNewVersion: (build) => {
      if (!autoReloadRoute(router.state.match?.route.name) || !claimReload(sessionStore(), build)) {
        appStatus.applyUpdate ??= () => window.location.reload();
        return;
      }
      const reload = (): void => {
        if (isEditing(document.activeElement)) window.setTimeout(reload, 30_000);
        else window.location.reload();
      };
      reload();
    },
    window,
    document,
  });
}

start();
