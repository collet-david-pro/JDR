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
  readonly value: string | number | boolean | null;
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
