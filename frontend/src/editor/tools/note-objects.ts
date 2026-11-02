/** Builders of the P9b2a objects (pin, zone, trap, secret) with the values the server imposes. */
import type { MapObject, ObjectLayerId, ObjectVisibility, Point } from '../contracts';
import type { NoteObject } from '../contracts-notes';
import { round3 } from '../model/scene-values';
import { uid } from './object-common';
import type { ToolContext } from './types';

export function polygonOf(points: readonly Point[]): { polygon: { x: number; y: number }[] } {
  return { polygon: points.map((p) => ({ x: round3(p[0]), y: round3(p[1]) })) };
}

export function pointOf(p: Point): { x: number; y: number } {
  return { x: round3(p[0]), y: round3(p[1]) };
}

/** A new object of the notes family (never locked, on the shown floor). */
export function newNoteObject(
  ctx: ToolContext,
  type: NoteObject['type'],
  layer: ObjectLayerId,
  visibility: ObjectVisibility,
  geometry: unknown,
  props: unknown,
): MapObject {
  return {
    uid: uid(ctx),
    floor: ctx.doc.floor,
    type,
    layer,
    geometry,
    props,
    visibility,
    locked: false,
    sort_order: 0,
    rev: 1,
  } as MapObject;
}

/** Link of a tool option, dropped when the note no longer exists. */
export function validNote(ctx: ToolContext, note: string | null): string | null {
  if (note === null) return null;
  return ctx.doc.notes.get(note) === undefined ? null : note;
}
