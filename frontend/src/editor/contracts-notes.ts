/**
 * P9b1 contract of the notes, pins, zones, traps and secrets (server side done, P9b2 builds on it).
 * Kept apart from contracts.ts. JSON ids are strings; coordinates in cells.
 *
 * Reading: GET /maps/{id} and the GM snapshot give `map.notes: MapNote[]`; the player / screen
 * snapshot gives `map.notes: PlayerNote[]`, only those he may read. The URL of a note's image comes
 * from GET /sessions/{id}/preload (`assets[].id === asset_id`, reload it after a `note.shared`).
 */

export type NoteAudience = 'gm' | 'players' | 'all';

/** GM / co-GM form of a note. */
export interface MapNote {
  readonly uid: string;
  readonly title: string;
  /** Markdown, stored as it is (at most 20 000 characters). */
  readonly body: string;
  readonly asset_id: string | null;
  readonly audience: NoteAudience;
  /** Accounts of the audience `players`, empty otherwise. */
  readonly audience_users: readonly string[];
  readonly read_aloud: boolean;
  readonly updated_at: string;
}

/** What a player or a screen receives of a note. */
export interface PlayerNote {
  readonly uid: string;
  readonly title: string;
  readonly body: string;
  readonly asset_id: string | null;
}

// ---- Ops of POST /maps/{id}/ops -----------------------------------------------------------------

export interface NoteValues {
  readonly title: string;
  readonly body: string;
  readonly asset_id?: string | null;
  readonly audience?: NoteAudience;
  /** Required and non-empty when `audience` is `players`, ignored otherwise. */
  readonly audience_users?: readonly string[];
  readonly read_aloud?: boolean;
}

export interface NoteAddOp {
  readonly type: 'note.add';
  readonly note: NoteValues & { readonly uid: string };
}

export interface NoteUpdateOp {
  readonly type: 'note.update';
  readonly uid: string;
  readonly patch: Partial<NoteValues>;
}

export interface NoteRemoveOp {
  readonly type: 'note.remove';
  readonly uid: string;
}

/** Hides again every trap and secret of the map. Not undoable on the client. */
export interface SecretsResetOp {
  readonly type: 'secrets.reset';
}

export type NoteOp = NoteAddOp | NoteUpdateOp | NoteRemoveOp | SecretsResetOp;

// ---- Objects ------------------------------------------------------------------------------------

export interface PolygonPoint {
  readonly x: number;
  readonly y: number;
}

/** 3 to 200 points. */
export interface PolygonGeometry {
  readonly polygon: readonly PolygonPoint[];
}

export type ObjectVisibility = 'all' | 'gm' | 'hidden_until_revealed';

interface NoteObjectBase {
  readonly uid: string;
  readonly floor: string;
  readonly layer: string;
  readonly visibility: ObjectVisibility;
  readonly locked: boolean;
  readonly sort_order: number;
  readonly rev: number;
}

export type PinIcon = 'place' | 'danger' | 'treasure' | 'npc' | 'info';

/** Layer: any but `gm`. With a note, it is visible exactly when the note is. */
export interface PinObject extends NoteObjectBase {
  readonly type: 'pin';
  readonly geometry: { readonly x: number; readonly y: number };
  readonly props: { readonly icon: PinIcon; readonly color: string; readonly note: string | null };
}

/** Layer and visibility `gm` imposed: never sent to a player or a screen. */
export interface ZoneObject extends NoteObjectBase {
  readonly type: 'zone';
  readonly geometry: PolygonGeometry;
  readonly props: { readonly kind: 'description'; readonly note: string | null; readonly show_on_enter: boolean };
}

/** Layer: any but `gm`; visibility `hidden_until_revealed` imposed. */
export interface TrapObject extends NoteObjectBase {
  readonly type: 'trap';
  readonly geometry: { readonly x: number; readonly y: number } | PolygonGeometry;
  readonly props: { readonly note: string | null; readonly reveal_effect: 'pulse' | 'none' };
}

export type SecretKind = 'passage' | 'room' | 'object';

/**
 * Visibility `hidden_until_revealed` imposed. `passage`: `{a, b}`, layer `walls`, a plain wall for
 * the players until it is revealed. `room` / `object`: `{polygon}`, layer any but `gm`.
 */
export interface SecretObject extends NoteObjectBase {
  readonly type: 'secret';
  readonly geometry:
    | { readonly a: readonly [number, number]; readonly b: readonly [number, number] }
    | PolygonGeometry;
  readonly props: { readonly kind: SecretKind; readonly note: string | null };
}

export type NoteObject = PinObject | ZoneObject | TrapObject | SecretObject;

// ---- Session actions (POST /sessions/{id}/actions, GM / co-GM only) ------------------------------

export interface NoteShareAction {
  readonly type: 'note.share';
  readonly note_uid: string;
  readonly audience: NoteAudience;
  /** Required and non-empty when `audience` is `players`. */
  readonly users?: readonly string[];
}

/** Reads a note aloud (`note.read_aloud`) without changing its audience. */
export interface NoteShowByUidAction {
  readonly type: 'note.show';
  readonly note_uid: string;
}

export interface SecretRevealAction {
  readonly type: 'secret.reveal';
  readonly uid: string;
}

export interface TrapRevealAction {
  readonly type: 'trap.reveal';
  readonly uid: string;
}

export type NoteAction = NoteShareAction | NoteShowByUidAction | SecretRevealAction | TrapRevealAction;

// ---- Events --------------------------------------------------------------------------------------

/**
 * Recipient version (`view: player | display`, audiences `user` and `displays`): he gains the note
 * or its contents changed. GM version (`view: gm`, audience `gm`, after `note.share`): `MapNote`.
 */
export interface NoteSharedEvent {
  readonly note: PlayerNote | MapNote;
  readonly view?: 'gm' | 'player' | 'display';
}

/** He loses the note (hidden again or removed). */
export interface NoteHiddenEvent {
  readonly uid: string;
  readonly view?: 'player' | 'display';
}

/** Audience gm, ephemeral: a token of a player entered a `show_on_enter` zone. */
export interface ZoneEnteredEvent {
  readonly zone_uid: string;
  readonly note_uid: string;
  readonly title: string;
  readonly token_uid: string;
  readonly view?: 'gm';
}
