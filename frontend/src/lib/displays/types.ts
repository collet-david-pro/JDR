/**
 * Projection screens (etapes/P07 "contrat"): settings, the GM's view of a screen (DisplayInfo)
 * and what the screen itself reads (DisplayMe). Identifiers are strings, dates ISO 8601 UTC.
 */
import type { SessionCamera, SessionStatus, PauseScreen } from '../sessions/types';

export type Rotation = 0 | 90 | 180 | 270;

/** D8. The screen itself may only change `diagonal_in`, `px_per_mm`, `rotation` and `mirror`. */
export interface DisplaySettings {
  readonly diagonal_in: number | null;
  readonly px_per_mm: number | null;
  readonly mm_per_cell: number;
  readonly rotation: Rotation;
  readonly mirror: boolean;
  readonly show_tokens: boolean;
  readonly follow_camera: boolean;
  readonly view_lock: ViewLock | null;
}

export interface ViewLock {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly floor_id: string | null;
}

export const DEVICE_SETTING_KEYS = ['diagonal_in', 'px_per_mm', 'rotation', 'mirror'] as const;
export type DeviceSettingKey = (typeof DEVICE_SETTING_KEYS)[number];
/** PATCH /display/me. */
export type DeviceSettingsPatch = Partial<Pick<DisplaySettings, DeviceSettingKey>>;

export const DEFAULT_MM_PER_CELL = 25;

export interface PairingInfo {
  readonly code: string;
  readonly expires_at: string;
  readonly url: string;
}

export type DisplayState = 'pending' | 'active';

/** What the GM sees of a screen. `pairing` only on creation / code regeneration. */
export interface DisplayInfo {
  readonly id: string;
  readonly session_id: string | null;
  readonly name: string;
  readonly state: DisplayState;
  readonly online: boolean;
  readonly last_seen_at: string | null;
  readonly paired_at: string | null;
  readonly user_agent: string | null;
  readonly settings: DisplaySettings;
  readonly pairing: PairingInfo | null;
}

export interface DisplayList {
  readonly displays: readonly DisplayInfo[];
}

/** Partial settings the GM may change (PATCH /displays/{id}). */
export type DisplaySettingsPatch = Partial<DisplaySettings>;

export interface DisplayPatch {
  readonly name?: string;
  readonly settings?: DisplaySettingsPatch;
}

export type DisplayMeStatus = 'lobby' | 'running' | 'paused' | 'waiting';

export interface DisplayMeSession {
  readonly id: string;
  readonly game_id: string;
  readonly name: string;
  readonly state: SessionStatus;
  readonly current_map_id: string | null;
  readonly current_floor_id: string | null;
  readonly camera: SessionCamera | null;
  readonly pause_screen: (PauseScreen & { readonly url: string | null }) | null;
}

/** GET /display/me (and the answer of POST /display/pair, under `display`). */
export interface DisplayMe {
  readonly id: string;
  readonly name: string;
  readonly settings: DisplaySettings;
  readonly session: DisplayMeSession;
  readonly status: DisplayMeStatus;
  readonly last_event_id: string;
}

/** Event `display.updated`: the public settings of a screen. */
export interface DisplayUpdatedPayload {
  readonly display: {
    readonly id: string;
    readonly session_id: string | null;
    readonly name: string;
    readonly state: DisplayState;
    readonly settings: DisplaySettings;
  };
}

/** Event `display.revoked`. */
export interface DisplayRevokedPayload {
  readonly display_id: string;
}

/** Status of a screen as `DisplayRun` shows it. */
export type DisplayStatus = 'unpaired' | 'pairing' | 'waiting' | 'lobby' | 'running' | 'paused';
