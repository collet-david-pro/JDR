/**
 * Projection screens, GM side (the normal API, with the GM's session): create a screen (pairing
 * code), list, rename / change the settings, revoke, new code, attach a screen of another session.
 * Errors are ApiError: 409 `display_limit` (8 max), `display_not_pending`, `display_not_reusable`,
 * `invalid_transition`; 422 with `fields["settings.<key>"]`.
 */
import type { ApiClient } from '../api';
import type { DisplayInfo, DisplayList, DisplayPatch } from './types';

const seg = (id: string): string => encodeURIComponent(id);

export class DisplaysClient {
  constructor(private readonly api: ApiClient) {}

  /** POST /sessions/{id}/displays: a pending screen with its `pairing` code. */
  async create(sessionId: string, name: string): Promise<DisplayInfo> {
    return (await this.api.post<DisplayInfo>(`/sessions/${seg(sessionId)}/displays`, { name }))
      .data;
  }

  async list(sessionId: string, signal?: AbortSignal): Promise<DisplayList> {
    const { data } = await this.api.get<Partial<DisplayList>>(
      `/sessions/${seg(sessionId)}/displays`,
      signal ? { signal } : {},
    );
    return { displays: data.displays ?? [], reusable: data.reusable ?? [] };
  }

  /** PATCH /displays/{id}: partial `settings`. */
  async update(displayId: string, patch: DisplayPatch): Promise<DisplayInfo> {
    return (await this.api.patch<DisplayInfo>(`/displays/${seg(displayId)}`, patch)).data;
  }

  /** DELETE /displays/{id}: revokes the screen (it goes back to the pairing page). */
  async remove(displayId: string): Promise<void> {
    await this.api.delete<null>(`/displays/${seg(displayId)}`);
  }

  /** POST /displays/{id}/regenerate-code (pending screens only). */
  async regenerateCode(displayId: string): Promise<DisplayInfo> {
    return (await this.api.post<DisplayInfo>(`/displays/${seg(displayId)}/regenerate-code`, {}))
      .data;
  }

  /** POST /sessions/{id}/displays/{displayId}/attach: reuses a screen of another session. */
  async attach(sessionId: string, displayId: string): Promise<DisplayInfo> {
    return (
      await this.api.post<DisplayInfo>(
        `/sessions/${seg(sessionId)}/displays/${seg(displayId)}/attach`,
        {},
      )
    ).data;
  }
}
