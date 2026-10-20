/**
 * Registers the service worker (production only, see main.ts).
 * The worker lives at the installation root: scope = base_path + '/'.
 * When a new version is waiting, `onUpdate` receives a function that activates it and
 * reloads the page; nothing is ever reloaded without a user action.
 */
export function registerServiceWorker(
  basePath: string,
  onUpdate: (activate: () => void) => void,
): void {
  if (!('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  let reloadRequested = false;

  container.addEventListener('controllerchange', () => {
    if (!reloadRequested) return;
    reloadRequested = false;
    window.location.reload();
  });

  const notify = (worker: ServiceWorker): void => {
    onUpdate(() => {
      reloadRequested = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  const register = (): void => {
    container
      .register(`${basePath}/sw.js`, { scope: `${basePath}/` })
      .then((registration) => {
        if (registration.waiting !== null && container.controller !== null) {
          notify(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (worker === null) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && container.controller !== null) notify(worker);
          });
        });
      })
      .catch((error: unknown) => {
        console.warn('[sw] registration failed', error);
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
