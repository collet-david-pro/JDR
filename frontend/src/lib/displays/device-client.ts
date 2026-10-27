/**
 * Projection screens, device side: pairing and the screen's own record. Every request goes
 * through the screen's ApiClient (`as=display`, device cookie `jdr_display`). Answers: 401
 * `display_unpaired` (unknown or revoked screen), 422 `display_code_invalid`, 429 (too many tries).
 */
import type { ApiClient } from '../api';
import type { DeviceSettingsPatch, DisplayMe } from './types';

export class DeviceClient {
  constructor(private readonly api: ApiClient) {}

  /** POST /display/pair {code} (public, anonymous CSRF). */
  async pair(code: string): Promise<DisplayMe> {
    const { data } = await this.api.post<{ display: DisplayMe }>(
      '/display/pair',
      { code: code.trim() },
      { notifyUnauthorized: false },
    );
    return data.display;
  }

  /** GET /display/me. */
  async me(signal?: AbortSignal): Promise<DisplayMe> {
    return (await this.api.get<DisplayMe>('/display/me', signal ? { signal } : {})).data;
  }

  /** PATCH /display/me: the four settings the screen owns. */
  async patchMe(settings: DeviceSettingsPatch): Promise<DisplayMe> {
    return (await this.api.patch<DisplayMe>('/display/me', { settings })).data;
  }

  /** POST /display/unpair. */
  async unpair(): Promise<void> {
    await this.api.post<null>('/display/unpair', {});
  }
}
