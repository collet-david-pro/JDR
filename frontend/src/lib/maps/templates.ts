/**
 * Map templates API (P9c1): GET /templates, POST /maps/{id}/save-as-template,
 * POST /templates/{id}/instantiate, DELETE /templates/{id}. A template belongs to no game: it
 * is a map saved apart (private to its author, or shared with the whole site by an admin) from
 * which new maps are created. Identifiers are strings.
 */
import type { ApiClient } from '../api';
import type { MapDetail } from '../types';

export type TemplateScope = 'private' | 'site';

export interface MapTemplate {
  readonly id: string;
  readonly name: string;
  readonly scope: TemplateScope;
  /** Shipped with the application (taverne, crypte, forêt, grotte). */
  readonly builtin: boolean;
  readonly kind: 'battle' | 'world';
  readonly width: number;
  readonly height: number;
  readonly floors: number;
  readonly notes: number;
  readonly owned: boolean;
  readonly can_delete: boolean;
}

export interface SaveTemplateInput {
  readonly name: string;
  readonly scope: TemplateScope;
}

export interface InstantiateInput {
  readonly game_id: string;
  readonly name?: string;
}

/** Field error code returned (fields.scope) when a site template would use a private asset. */
export const PRIVATE_ASSETS = 'private_assets';

const seg = (id: string): string => encodeURIComponent(id);

/** Client for the map template endpoints. */
export class TemplatesClient {
  constructor(private readonly api: Pick<ApiClient, 'get' | 'post' | 'delete'>) {}

  async list(): Promise<MapTemplate[]> {
    return (await this.api.get<MapTemplate[]>('/templates')).data;
  }

  async save(mapId: string, input: SaveTemplateInput): Promise<MapTemplate> {
    return (await this.api.post<MapTemplate>(`/maps/${seg(mapId)}/save-as-template`, input)).data;
  }

  async instantiate(templateId: string, input: InstantiateInput): Promise<MapDetail> {
    return (await this.api.post<MapDetail>(`/templates/${seg(templateId)}/instantiate`, input))
      .data;
  }

  async remove(templateId: string): Promise<void> {
    await this.api.delete(`/templates/${seg(templateId)}`);
  }
}

export interface TemplateSections {
  /** Built-in templates and those shared with the site. */
  readonly shared: readonly MapTemplate[];
  /** The templates of the user. */
  readonly mine: readonly MapTemplate[];
}

/** "Modèles livrés et du site" then "Mes modèles"; built-in first, then by name. */
export function templateSections(templates: readonly MapTemplate[]): TemplateSections {
  const byName = (a: MapTemplate, b: MapTemplate): number =>
    Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name, 'fr');
  return {
    shared: templates.filter((x) => x.scope === 'site').sort(byName),
    mine: templates.filter((x) => x.scope === 'private').sort(byName),
  };
}
