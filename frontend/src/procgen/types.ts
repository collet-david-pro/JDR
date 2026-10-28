/** Shared contract of the procedural generators (P8). Pure data: no DOM, no uid, no palette index. */
import type { WallKind } from '../editor/contracts';
import type { LightPresetId } from '../editor/tools/types';
import type { Rng } from './prng';

export type GeneratorId = 'dungeon' | 'cave' | 'outdoor' | 'village';
/** "floor.stone", "decor.barrel"… (see pack-keys.ts). */
export type PackKey = string;
export interface GenCell {
  x: number;
  y: number;
  key: PackKey;
  variant?: number;
  flags?: number;
}
export interface GenWall {
  points: [number, number][];
  closed: boolean;
  kind: WallKind;
}
export interface GenDoor {
  a: [number, number];
  b: [number, number];
  secret: boolean;
  locked: boolean;
  swing: 'a' | 'b' | 'slide';
}
export interface GenWindow {
  a: [number, number];
  b: [number, number];
  kind: 'glass' | 'bars' | 'opening';
}
export interface GenLight {
  x: number;
  y: number;
  preset: LightPresetId;
}
export interface GenRoom {
  id: number;
  kind: string;
  rect: { x: number; y: number; w: number; h: number } | null;
  cells: number;
}
export interface GenFloor {
  ground: GenCell[];
  terrain: GenCell[];
  decor: GenCell[];
  walls: GenWall[];
  doors: GenDoor[];
  windows: GenWindow[];
  lights: GenLight[];
  rooms: GenRoom[];
  entrance: [number, number] | null;
  exit: [number, number] | null;
}
export interface GenResult {
  generator: GeneratorId;
  gen_version: number;
  seed: string;
  width: number;
  height: number;
  floors: GenFloor[];
  stats: Record<string, number>;
}
export interface GenContext {
  rng: Rng;
  progress: (phase: string, done: number, total: number) => void;
  zone?: { width: number; height: number; openings: [number, number][] };
}
export type Generator<P> = {
  id: GeneratorId;
  version: number;
  defaults: P;
  presets: Record<string, Partial<P>>;
  validate(p: unknown): P;
  generate(p: P, ctx: GenContext): GenResult;
};

/** Utility types shared by the geometry helpers. */
export type Pt = readonly [number, number];
