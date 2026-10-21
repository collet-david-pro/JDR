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
