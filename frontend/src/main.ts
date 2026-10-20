import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { ApiClient } from './lib/api';
import { readBootConfig, type BootConfig } from './lib/boot';
import { t } from './lib/i18n';
import type { PageComponent } from './lib/page';
import { setServices } from './lib/services';
import { registerServiceWorker } from './lib/sw-register';
import { Router } from './router';
import { routes } from './routes';
import { appStatus } from './stores/app.svelte';
import { prefs } from './stores/prefs.svelte';

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
      const { path, query } = router.state.location;
      if (path === '/login') return;
      const next = query.size > 0 ? `${path}?${query.toString()}` : path;
      router.navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    },
    onMaintenance: () => {
      appStatus.maintenance = true;
    },
  });

  setServices({ boot, api, router });
  router.start();
  mount(App, { target });

  if (import.meta.env.PROD) {
    registerServiceWorker(boot.basePath, (activate) => {
      appStatus.applyUpdate = activate;
    });
  }
}

start();
