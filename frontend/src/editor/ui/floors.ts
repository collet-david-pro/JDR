/**
 * Floors of the editing session (P9a2): the list and the shown floor mirrored in the UI state, switching
 * (fetching the content of a floor not yet in memory), adding / renaming / re-levelling / deleting (all
 * undoable history commands), and the ghost of the floor below.
 */
import type { Command, MapOp, SceneEngineApi } from '../contracts';
import type { History, OpsOrigin } from '../history/History';
import {
  floorAddCommand,
  floorRemoveCommand,
  floorUpdateCommand,
  nextFreeLevel,
} from '../model/floor-commands';
import type { FloorMeta } from '../model/FloorSlot';
import { MAX_FLOORS, type MapDocument } from '../model/MapDocument';
import { MapOpError } from '../model/ops';
import type { EditorUiState } from '../state.svelte';
import type { ToolNotice } from '../tools/types';
import { newObjectUid } from '../util/uid';

type Engine = Pick<SceneEngineApi, 'setGhost'>;

export interface FloorsHost {
  notify(notice: ToolNotice): void;
  /** Selection and overlay are dropped when the shown floor changes. */
  floorChanged(): void;
}

/** Fetches the tiles and fog of a floor (MapSync); absent for a map not saved on the server. */
export type FloorLoader = (floor: FloorMeta) => Promise<void>;

/** Controller for floor management in the editor UI. */
export class FloorsController {
  private engine: Engine | null = null;
  private loader: FloorLoader | null = null;
  private readonly offs: (() => void)[] = [];
  private ghostUid: string | null = null;
  private seq = 0;

  constructor(
    private readonly doc: MapDocument,
    private readonly history: History,
    private readonly ui: EditorUiState,
    private readonly host: FloorsHost,
    private readonly newUid: () => string = newObjectUid,
  ) {
    this.offs.push(
      this.doc.onFloorsChanged((e) => {
        this.sync();
        if (e.current) this.host.floorChanged();
        this.prepareGhost();
      }),
      this.history.onOps((ops, origin) => this.followUndo(ops, origin)),
    );
    this.sync();
  }

  attach(engine: Engine): void {
    this.engine = engine;
    this.updateGhost(true);
  }

  detach(): void {
    this.ghostUid = null;
    this.engine?.setGhost(null);
    this.engine = null;
  }

  dispose(): void {
    this.detach();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  setLoader(loader: FloorLoader | null): void {
    this.loader = loader;
    this.prepareGhost();
  }

  // ---- Switching -------------------------------------------------------------------------

  /** Shows a floor, fetching it first when it is not in memory. False when it cannot be shown. */
  async select(uid: string): Promise<boolean> {
    if (uid === this.doc.floor) return true;
    const meta = this.doc.floorMeta(uid);
    if (meta === undefined) return false;
    if (!(await this.ensureLoaded(meta))) return false;
    if (this.doc.floorMeta(uid) === undefined) return false;
    this.doc.setCurrentFloor(uid);
    return true;
  }

  private async ensureLoaded(meta: FloorMeta, silent = false): Promise<boolean> {
    if (meta.loaded) return true;
    if (this.loader === null) {
      this.doc.markFloorLoaded(meta.uid);
      return true;
    }
    const ticket = ++this.seq;
    if (!silent) this.ui.floorBusy = true;
    try {
      await this.loader(meta);
      this.doc.markFloorLoaded(meta.uid);
      return true;
    } catch (error) {
      console.error(error);
      if (!silent) this.host.notify({ code: 'floor_load_failed' });
      return false;
    } finally {
      if (ticket === this.seq) this.ui.floorBusy = false;
    }
  }

  // ---- Commands --------------------------------------------------------------------------

  /** Adds a floor (next free level unless given) and shows it. Returns its uid, or null when refused. */
  async add(name: string, level?: number): Promise<string | null> {
    const levels = this.doc.floors().map((f) => f.level);
    if (levels.length >= MAX_FLOORS) {
      this.host.notify({ code: 'floor_limit' });
      return null;
    }
    const at = level ?? nextFreeLevel(levels);
    const trimmed = name.trim();
    if (at === null || trimmed === '' || [...trimmed].length > 60 || levels.includes(at)) {
      this.host.notify({ code: 'floor_invalid' });
      return null;
    }
    const uid = this.uniqueUid();
    if (!this.run(floorAddCommand(uid, trimmed, at))) return null;
    this.doc.setCurrentFloor(uid);
    return uid;
  }

  rename(uid: string, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed === '' || [...trimmed].length > 60) {
      this.host.notify({ code: 'floor_invalid' });
      return false;
    }
    return this.run(floorUpdateCommand(uid, { name: trimmed }));
  }

  setLevel(uid: string, level: number): boolean {
    if (!Number.isInteger(level) || level < -9 || level > 9) {
      this.host.notify({ code: 'floor_invalid' });
      return false;
    }
    if (this.doc.floors().some((f) => f.uid !== uid && f.level === level)) {
      this.host.notify({ code: 'floor_invalid' });
      return false;
    }
    return this.run(floorUpdateCommand(uid, { level }));
  }

  /**
   * Deletes a floor and all its content. The content is fetched first (the undo recreates it): when it
   * cannot be read (offline), nothing is deleted.
   */
  async remove(uid: string): Promise<boolean> {
    const meta = this.doc.floorMeta(uid);
    if (meta === undefined) return false;
    if (this.doc.floors().length <= 1) {
      this.host.notify({ code: 'floor_last' });
      return false;
    }
    if (!(await this.ensureLoaded(meta))) return false;
    return this.run(floorRemoveCommand(uid));
  }

  // ---- Internals -------------------------------------------------------------------------

  private run(command: Command): boolean {
    try {
      this.history.execute(command);
      return true;
    } catch (error) {
      if (!(error instanceof MapOpError)) throw error;
      this.host.notify({ code: error.code === 'last_floor' ? 'floor_last' : 'floor_invalid' });
      return false;
    }
  }

  private uniqueUid(): string {
    for (;;) {
      const uid = this.newUid();
      if (this.doc.floorMeta(uid) === undefined && !/^[0-9]+$/.test(uid)) return uid;
    }
  }

  /** Undoing a floor deletion shows the floor again. */
  private followUndo(ops: readonly MapOp[], origin: OpsOrigin): void {
    if (origin !== 'undo') return;
    for (const op of ops) {
      if (op.type === 'floor.add') {
        if (this.doc.floorMeta(op.floor.uid) !== undefined) this.doc.setCurrentFloor(op.floor.uid);
        return;
      }
    }
  }

  private sync(): void {
    this.ui.floors = this.doc.floors().map((f) => ({
      uid: f.uid,
      name: f.name,
      level: f.level,
      loaded: f.loaded,
    }));
    this.ui.currentFloor = this.doc.floor;
  }

  /** (Re)selects the ghost: the floor right below, when it is in memory and the setting is on. */
  updateGhost(force = false): void {
    const engine = this.engine;
    if (engine === null) return;
    const below = this.ui.floorGhost ? this.doc.floorBelow() : undefined;
    const uid = below?.loaded === true ? below.uid : null;
    if (uid === this.ghostUid && !force) return;
    this.ghostUid = uid;
    engine.setGhost(uid === null ? null : this.doc.floorView(uid));
  }

  setGhostVisible(visible: boolean): void {
    this.ui.floorGhost = visible;
    this.prepareGhost();
  }

  /** The floor below that is not in memory yet is fetched (quietly) so that the ghost can show it. */
  private prepareGhost(): void {
    const below = this.ui.floorGhost ? this.doc.floorBelow() : undefined;
    if (below !== undefined && !below.loaded && this.loader !== null) {
      void this.ensureLoaded(below, true).then((ok) => {
        if (ok) this.doc.markFloorLoaded(below.uid);
        this.updateGhost();
      });
    }
    this.updateGhost();
  }
}
