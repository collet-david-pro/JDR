/**
 * API data types of phase P1 (etapes/P01 "Contrat d'API P1"). Identifiers are strings,
 * dates are ISO 8601 UTC strings.
 */

export type Role = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';
export type RegistrationMode = 'open' | 'closed' | 'invite';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly username: string;
  readonly role: Role;
  readonly status: UserStatus;
  readonly locale: string;
  readonly storage_quota_bytes: number | null;
  readonly storage_used_bytes: number;
  readonly email_verified_at: string | null;
  readonly last_login_at: string | null;
  readonly created_at: string;
}

export type Prefs = Readonly<Record<string, unknown>>;

/** GET /auth/me */
export interface MeResponse {
  readonly user: User | null;
  readonly csrf: string;
  readonly prefs: Prefs;
  readonly registration_mode: RegistrationMode;
  readonly smtp_enabled: boolean;
}

/** POST /auth/login and POST /auth/register */
export interface AuthResult {
  readonly user: User;
  readonly csrf: string;
}

export interface LoginInput {
  readonly identifier: string;
  readonly password: string;
  readonly remember: boolean;
}

export interface RegisterInput {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly invitation_code?: string;
}

export interface ForgotResult {
  readonly mode: 'email' | 'contact_admin';
}

export interface InvitationCheck {
  readonly valid: boolean;
  readonly email: string | null;
}

export interface Device {
  readonly id: string;
  readonly user_agent: string;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly current: boolean;
}

export interface StorageUsage {
  readonly used_bytes: number;
  readonly quota_bytes: number | null;
}

export interface ResetLink {
  readonly url: string;
  readonly expires_at: string;
}

export interface AdminStats {
  readonly users: {
    readonly total: number;
    readonly active: number;
    readonly suspended: number;
    readonly admins: number;
  };
  readonly games: number;
  readonly maps: number;
  readonly storage_bytes: number;
  readonly active_sessions: number;
}

export type SmtpEncryption = 'none' | 'starttls' | 'tls';

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly encryption: SmtpEncryption;
  readonly username: string;
  readonly password_set: boolean;
  readonly from_email: string;
  readonly from_name: string;
}

export interface SiteSettings {
  readonly site_name: string;
  readonly base_url: string;
  readonly default_locale: string;
  readonly registration_mode: RegistrationMode;
  readonly default_quota_bytes: number;
  readonly max_upload_bytes: number;
  readonly max_dimension_px: number;
  readonly max_total_pixels: number;
  readonly max_frames: number;
  readonly max_animation_ms: number;
  readonly events_retention_hours: number;
  readonly versions_retention: number;
  readonly trash_days: number;
  readonly session_idle_hours: number;
  readonly use_db_sessions: boolean;
  readonly maintenance: boolean;
  readonly smtp: SmtpSettings;
}

export interface Invitation {
  readonly id: string;
  readonly email: string | null;
  readonly max_uses: number;
  readonly uses: number;
  readonly expires_at: string | null;
  readonly created_at: string;
  readonly created_by: string | { readonly id: string; readonly username: string } | null;
}

export interface CreatedInvitation {
  readonly invitation: Invitation;
  readonly code: string;
  readonly url: string;
}

export type CheckStatus = 'ok' | 'warn' | 'error';

export interface DiagnosticCheck {
  readonly id: string;
  readonly status: CheckStatus;
  /** Scalar, or a structured value (e.g. integrity: {version, files, modified, missing}). */
  readonly value: unknown;
  readonly hint_key: string | null;
}

export interface AuditEntry {
  readonly id: string;
  readonly user: { readonly id: string; readonly username: string } | null;
  readonly action: string;
  readonly entity: string | null;
  readonly entity_id: string | null;
  readonly data: unknown;
  readonly ip: string | null;
  readonly created_at: string;
}

export interface MigrationRow {
  readonly version: string;
  readonly name: string;
  readonly status: string;
  readonly applied_at: string | null;
  readonly duration_ms: number | null;
  readonly checksum_ok: boolean;
}

/* ------------------------------------------------------------------------------------------
 * Phase P2: assets (etapes/P02 "Contrat d'API P2").
 * ---------------------------------------------------------------------------------------- */

export const ASSET_KINDS = ['tile', 'object', 'token', 'texture', 'background'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Server-side scope of an asset, category or tag. */
export type AssetScope = 'personal' | 'general';

/** `scope` query parameter of GET /assets (`game:{id}` arrives in P3). */
export type AssetListScope = 'mine' | 'general';

export type AssetMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export type AssetSource = 'upload' | 'generated' | 'pack' | 'system';

export interface TagRef {
  readonly id: string;
  readonly name: string;
}

export interface Asset {
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly kind: AssetKind;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly is_animated: boolean;
  readonly frame_count: number;
  readonly duration_ms: number;
  readonly size_bytes: number;
  readonly scope: AssetScope;
  readonly owner_id: string | null;
  readonly category_id: string | null;
  readonly tags: readonly TagRef[];
  readonly favorite: boolean;
  readonly source: AssetSource;
  readonly created_at: string;
  /** Signed URLs (projet.md 9.3), relative to the site root, usable as is in <img src>. */
  readonly urls: { readonly full: string; readonly thumb: string };
}

/** GET /assets/limits */
export interface AssetLimits {
  readonly max_upload_bytes: number;
  readonly max_dimension_px: number;
  readonly max_total_pixels: number;
  readonly max_frames: number;
  readonly max_animation_ms: number;
  readonly accepted_mimes: readonly string[];
}

export interface AssetCategory {
  readonly id: string;
  readonly name: string;
  readonly parent_id: string | null;
  readonly sort_order: number;
  readonly scope: AssetScope;
}

export interface AssetTag {
  readonly id: string;
  readonly name: string;
  readonly scope: AssetScope;
}

export interface UsageRef {
  readonly id: string;
  /** Null when the map/token belongs to someone else (privacy, projet.md 11.2). */
  readonly name: string | null;
}

/** GET /assets/{id}/usages, and `usages` of a 409 `asset_in_use`. */
export interface AssetUsages {
  readonly maps: readonly UsageRef[];
  readonly tokens: readonly UsageRef[];
}

/** PATCH /assets/{id} */
export interface AssetPatch {
  readonly name?: string;
  readonly kind?: AssetKind;
  readonly category_id?: string | null;
  /** Tag names (created on the fly by the server). */
  readonly tags?: readonly string[];
}

/** Filters of GET /assets. */
export interface AssetFilters {
  readonly scope: AssetListScope;
  readonly kind?: AssetKind | '';
  readonly q?: string;
  readonly tag?: string;
  readonly category?: string;
  readonly favorites?: boolean;
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobProgress {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
}

/** Background job advanced by POST /jobs/{id}/step (packs). */
export interface Job {
  readonly id: string;
  readonly type: string;
  /** One of JobStatus; kept open to tolerate statuses added later. */
  readonly status: JobStatus | (string & {});
  readonly progress: JobProgress;
  readonly result: unknown;
}

/* ------------------------------------------------------------------------------------------
 * Phase P3: games, members, tokens and encounters (etapes/P03 "Contrat d'API P3").
 * Every distance (vision, light, encounter offsets) is expressed in grid cells.
 * ---------------------------------------------------------------------------------------- */

export type GameRole = 'gm' | 'co_gm' | 'player';
export type MemberRole = Exclude<GameRole, 'gm'>;

/** `state` filter of GET /games. */
export type GameState = 'active' | 'archived' | 'trash';

export interface GameSettings {
  readonly fog_strict: boolean;
  readonly players_blocked_by_walls: boolean;
  readonly players_can_move_own_tokens: boolean;
  readonly players_see_other_pcs: boolean;
  readonly unit_label: string;
  readonly unit_per_cell: number;
  readonly default_cell_px: number;
}

export interface UserRef {
  readonly id: string;
  readonly username: string;
}

export interface Game {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly cover_asset_id: string | null;
  /** Signed thumbnail URL of the cover (projet.md 9.3). */
  readonly cover_url: string | null;
  readonly gm: UserRef;
  readonly my_role: GameRole;
  readonly settings: GameSettings;
  readonly counts: { readonly maps: number; readonly tokens: number; readonly members: number };
  readonly archived_at: string | null;
  readonly deleted_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** POST /games */
export interface GameInput {
  readonly name: string;
  readonly description?: string;
  readonly settings?: Partial<GameSettings>;
}

/** PATCH /games/{id} (settings may be partial). */
export interface GamePatch {
  readonly name?: string;
  readonly description?: string;
  readonly cover_asset_id?: string | null;
  readonly settings?: Partial<GameSettings>;
}

export interface Member {
  readonly user: UserRef;
  /** The GM is listed with the role `gm`. */
  readonly role: GameRole;
  readonly joined_at: string;
}

export const TOKEN_KINDS = ['pc', 'npc', 'monster', 'object'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export interface TokenVision {
  readonly enabled: boolean;
  /** Cells. */
  readonly range: number;
  /** Darkvision, cells. */
  readonly dark: number;
}

export interface TokenLight {
  /** Bright light radius, cells. */
  readonly radius: number;
  /** Dim light radius, cells. */
  readonly dim_radius: number;
  /** "#rrggbb" */
  readonly color: string;
  /** 0..1 */
  readonly intensity: number;
  readonly flicker: boolean;
}

export interface Token {
  readonly id: string;
  readonly game_id: string;
  readonly name: string;
  readonly asset_id: string | null;
  readonly image: { readonly full: string; readonly thumb: string } | null;
  readonly kind: TokenKind;
  readonly size_w: number;
  readonly size_h: number;
  readonly default_owner_user_id: string | null;
  readonly vision: TokenVision;
  readonly light: TokenLight | null;
  readonly ring_color: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** POST /games/{id}/tokens and PATCH /tokens/{id}. */
export interface TokenInput {
  readonly name: string;
  readonly asset_id: string | null;
  readonly kind: TokenKind;
  readonly size_w: number;
  readonly size_h: number;
  readonly default_owner_user_id: string | null;
  readonly vision: TokenVision;
  readonly light: TokenLight | null;
  readonly ring_color: string | null;
}

export interface EncounterToken {
  readonly token_id: string;
  /** Offsets relative to the placement point, cells. */
  readonly dx: number;
  readonly dy: number;
}

export interface Encounter {
  readonly id: string;
  readonly game_id: string;
  readonly name: string;
  readonly notes: string | null;
  readonly tokens: readonly EncounterToken[];
  readonly created_at: string;
  readonly updated_at: string;
}

/** POST /games/{id}/encounters and PATCH /encounters/{id}. */
export interface EncounterInput {
  readonly name: string;
  readonly notes: string;
  readonly tokens: readonly EncounterToken[];
}

/* ------------------------------------------------------------------------------------------
 * Phase P4b: maps (etapes/P04 "Contrat d'API P4b", projet.md 9.2, 11.4, 12.1).
 * Coordinates and sizes are in cells.
 * ---------------------------------------------------------------------------------------- */

export type MapKind = 'battle' | 'world';

/** `state` filter of GET /games/{id}/maps. */
export type MapListState = 'active' | 'trash';

/** Item of GET /games/{id}/maps. */
export interface MapSummary {
  readonly id: string;
  readonly game_id: string;
  readonly name: string;
  /** Folder path, e.g. "Acte 1/Crypte"; null at the root. */
  readonly folder: string | null;
  readonly sort_order: number;
  readonly kind: MapKind;
  readonly grid: { readonly width: number; readonly height: number };
  /** Signed thumbnail URL (P4c), null until a thumbnail exists. */
  readonly thumb_url: string | null;
  readonly revision: number;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

export interface MapGrid {
  readonly type: 'square';
  readonly cell_px: number;
  readonly width: number;
  readonly height: number;
  readonly unit_label: string;
  readonly unit_per_cell: number;
}

export interface MapAmbient {
  readonly darkness: number;
  readonly tint: string | null;
  readonly time_of_day: string | number | null;
  readonly weather: { readonly type: string; readonly intensity: number };
}

/** Palette entry (index 0 is null). */
export interface MapPaletteEntry {
  readonly asset_id: string;
  readonly name: string;
  /** Signed full-size URL, null when the asset is no longer readable. */
  readonly url: string | null;
  readonly thumb_url: string | null;
  readonly autotile: string | null;
}

/** Layer of the stack (projet.md 12.1), bottom → top. */
export interface MapLayer {
  readonly id: string;
  readonly kind: 'tiles' | 'objects';
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
  readonly gm_only?: boolean;
}

export interface MapFloor {
  readonly id: string;
  readonly level: number;
  readonly name: string;
  readonly sort_order: number;
}

/** GET /maps/{id}, POST /games/{id}/maps, POST /maps/{id}/duplicate. */
export interface MapDetail extends Omit<MapSummary, 'grid'> {
  readonly grid: MapGrid;
  readonly theme: string;
  readonly ambient: MapAmbient;
  readonly palette: readonly (MapPaletteEntry | null)[];
  readonly layers: readonly MapLayer[];
  readonly floors: readonly MapFloor[];
  readonly format_version: number;
  readonly objects: readonly unknown[];
  readonly notes: readonly unknown[];
  readonly tokens_placed: readonly unknown[];
}

/** POST /games/{id}/maps */
export interface MapInput {
  readonly name: string;
  readonly folder?: string | null;
  readonly kind?: MapKind;
  readonly width: number;
  readonly height: number;
  readonly cell_px?: number;
  readonly unit_label?: string;
  readonly unit_per_cell?: number;
  readonly theme?: string;
}

/** PATCH /maps/{id} */
export interface MapPatch {
  readonly name?: string;
  readonly folder?: string | null;
  readonly sort_order?: number;
}

/** Op of POST /maps/{id}/ops, wire format (projet.md 11.4). */
export type WireMapOp =
  | {
      readonly type: 'tiles.set';
      readonly floor: string;
      readonly layer: string;
      readonly cells: readonly (readonly number[])[];
    }
  | {
      readonly type: 'palette.add';
      readonly index: number;
      readonly asset_id: string;
      readonly autotile?: string | null;
    }
  | {
      readonly type: 'map.meta';
      readonly name?: string;
      readonly grid?: Partial<Omit<MapGrid, 'type'>>;
      readonly layers?: readonly MapLayer[];
      readonly theme?: string;
      readonly ambient?: MapAmbient;
    };

/** Body of POST /maps/{id}/ops */
export interface MapOpsRequest {
  readonly base_revision: number;
  readonly client_op_id: string;
  readonly ops: readonly WireMapOp[];
}

/** Answer of POST /maps/{id}/ops */
export interface MapOpsResult {
  readonly revision: number;
  readonly applied?: number;
  readonly conflicts: readonly unknown[];
}

/* ------------------------------------------------------------------------------------------
 * Phase P4c: versions, export / import, thumbnail (etapes/P04 "Contrat d'API P4c",
 * projet.md 9.2, 11.4 "Versions", 12.1).
 * ---------------------------------------------------------------------------------------- */

export type MapVersionKind = 'auto' | 'manual' | 'pre_restore' | 'pre_generate' | 'pre_update';

/** Item of GET /maps/{id}/versions (most recent first), answer of POST /maps/{id}/versions. */
export interface MapVersion {
  readonly id: string;
  readonly map_id: string;
  /** Map revision captured by the snapshot. */
  readonly revision: number;
  readonly kind: MapVersionKind;
  readonly label: string | null;
  /** Size of the stored (compressed) snapshot. */
  readonly size_bytes: number;
  readonly created_by: { readonly id: string; readonly username: string } | null;
  readonly created_at: string;
}

/** Answer of POST /maps/{id}/versions/{vid}/restore. */
export interface MapRestoreResult {
  readonly revision: number;
  readonly map: MapDetail;
}

/** Asset reference of an imported document that the server could not resolve. */
export interface MissingAsset {
  /** "sha256:<hex>" */
  readonly ref: string;
  readonly name: string;
}

/** Answer of POST /games/{id}/maps/import. */
export interface MapImportResult {
  readonly map: MapDetail;
  readonly missing_assets: readonly MissingAsset[];
}

/** Answer of PUT /maps/{id}/thumbnail. */
export interface MapThumbnailResult {
  readonly thumb_url: string;
}
