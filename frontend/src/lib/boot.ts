/**
 * Boot configuration injected by the PHP shell (app/Views/shell.php):
 *
 *   <script id="jdr-boot" type="application/json">
 *     {"version":"1.0.0","api_base":"/base/api/v1","routing_mode":"rewrite","base_path":"/base","csrf":null}
 *   </script>
 *
 * In query routing mode api_base is "/base/index.php?r=/api/v1".
 * In development (Vite dev server, no PHP shell) the defaults below are used.
 */

export type RoutingMode = 'rewrite' | 'query';

export interface BootConfig {
  readonly version: string;
  /** API prefix, e.g. "/api/v1" or "/base/index.php?r=/api/v1". Never ends with "/". */
  readonly apiBase: string;
  readonly routingMode: RoutingMode;
  /** Installation sub-folder, "" at the domain root, otherwise "/folder" (no trailing "/"). */
  readonly basePath: string;
  readonly csrf: string | null;
}

export const BOOT_ELEMENT_ID = 'jdr-boot';

export const DEV_BOOT_CONFIG: BootConfig = Object.freeze({
  version: 'dev',
  apiBase: '/api/v1',
  routingMode: 'rewrite',
  basePath: '',
  csrf: null,
});

export class BootConfigError extends Error {
  override readonly name = 'BootConfigError';
}

/** Parses and validates the JSON text of the boot element. Throws BootConfigError. */
export function parseBootConfig(text: string): BootConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BootConfigError('Boot configuration is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BootConfigError('Boot configuration must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;

  const version = obj['version'];
  if (typeof version !== 'string' || version.trim() === '') {
    throw new BootConfigError('Boot configuration: "version" must be a non-empty string');
  }

  const routingMode = obj['routing_mode'];
  if (routingMode !== 'rewrite' && routingMode !== 'query') {
    throw new BootConfigError('Boot configuration: "routing_mode" must be "rewrite" or "query"');
  }

  const basePath = normalizeBasePath(obj['base_path']);
  const apiBase = normalizeApiBase(obj['api_base']);

  const csrf = obj['csrf'] ?? null;
  if (csrf !== null && (typeof csrf !== 'string' || csrf === '')) {
    throw new BootConfigError('Boot configuration: "csrf" must be null or a non-empty string');
  }

  return Object.freeze({ version, apiBase, routingMode, basePath, csrf });
}

function normalizeBasePath(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BootConfigError('Boot configuration: "base_path" must be a string');
  }
  const trimmed = value.replace(/\/+$/, '');
  if (trimmed !== '' && !trimmed.startsWith('/')) {
    throw new BootConfigError('Boot configuration: "base_path" must be empty or start with "/"');
  }
  if (/[?#\s]/.test(trimmed) || trimmed.includes('//')) {
    throw new BootConfigError('Boot configuration: "base_path" contains invalid characters');
  }
  return trimmed;
}

function normalizeApiBase(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    throw new BootConfigError('Boot configuration: "api_base" must be a same-origin absolute path');
  }
  if (/[#\s]/.test(value)) {
    throw new BootConfigError('Boot configuration: "api_base" contains invalid characters');
  }
  return value.replace(/\/+$/, '');
}

/**
 * Reads the boot configuration from the document.
 * Missing element: development defaults when `dev` is true, otherwise an error.
 */
export function readBootConfig(doc: Pick<Document, 'getElementById'>, dev: boolean): BootConfig {
  const element = doc.getElementById(BOOT_ELEMENT_ID);
  if (element === null) {
    if (dev) return DEV_BOOT_CONFIG;
    throw new BootConfigError(`Boot element #${BOOT_ELEMENT_ID} is missing`);
  }
  return parseBootConfig(element.textContent ?? '');
}
