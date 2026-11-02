/**
 * Builds the four built-in map templates (P9c1) into app/Domain/Maps/templates/*.json and
 * manifest.json. Run with: npx vitest run --config vitest.templates.config.ts
 *
 * Each template = the ops of `bindResult` on a fixed seed (tiles, palette with `pack:<key>`
 * placeholders, walls, doors, windows, lights) + a few example lights and notes (GM only).
 * The PHP side (BuiltinTemplates) swaps `pack:<key>` for the asset ids of the base pack and
 * applies the ops through OpsApplier. No random: same seeds => same files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapDocument } from '../src/editor/model/MapDocument';
import { LIGHT_PRESETS } from '../src/editor/tools/object-common';
import type { LightPresetId } from '../src/editor/tools/types';
import { bindResult, type PackAsset } from '../src/procgen/bind';
import { registerAllGenerators } from '../src/procgen/generators';
import { fallbackKey, PACK_KEYS } from '../src/procgen/pack-keys';
import { runGenerator } from '../src/procgen/registry';
import type { GenFloor, GeneratorId } from '../src/procgen/types';

const OUT = fileURLToPath(new URL('../../app/Domain/Maps/templates/', import.meta.url));
const FLOOR = 'f1';
export const TEMPLATES_VERSION = 1;

interface NoteSpec {
  title: string;
  body: string;
}
interface Spec {
  id: string;
  name: string;
  generator: GeneratorId;
  seed: string;
  params: Record<string, number | string | boolean>;
  theme: 'parchment' | 'dark';
  darkness: number;
  lights: LightPresetId;
  notes: NoteSpec[];
}

const SPECS: Spec[] = [
  {
    id: 'taverne',
    name: 'Taverne',
    generator: 'village',
    // Compact village: the interior planner of the village generator is not exposed on its own.
    seed: 'taverne-1',
    params: { width: 44, height: 44, buildings: 3, theme: 'town', interiors: true, decor: 0.7 },
    theme: 'parchment',
    darkness: 0,
    lights: 'lantern',
    notes: [
      {
        title: 'La salle commune',
        body: "Un feu crépite dans l'âtre. Des voyageurs fatigués boivent en silence ; l'aubergiste essuie une chope en vous observant.",
      },
      {
        title: "Rumeurs de l'auberge",
        body: 'Tirer une rumeur au hasard : une caravane a disparu sur la route du nord ; le maire cache quelque chose ; des lumières brillent dans la vieille tour.',
      },
      {
        title: 'La cave',
        body: "Sous la trappe de la réserve, la cave communique avec un ancien passage muré. À toi de décider ce qui s'y cache.",
      },
    ],
  },
  {
    id: 'crypte',
    name: 'Crypte',
    generator: 'dungeon',
    seed: 'crypte-1',
    params: {
      width: 50,
      height: 50,
      rooms: 10,
      theme: 'crypt',
      door_p: 0.7,
      secret_p: 0.1,
      decor: 0.6,
    },
    theme: 'dark',
    darkness: 0.35,
    lights: 'torch',
    notes: [
      {
        title: "L'entrée de la crypte",
        body: "L'air est froid et sent la poussière. Des inscriptions à demi effacées courent le long des murs.",
      },
      {
        title: 'Le sarcophage',
        body: 'Le couvercle est scellé. Un jet de Force difficile le déplace ; ce qui repose dessous se réveille alors.',
      },
      {
        title: 'Le trésor oublié',
        body: 'Quelques pièces anciennes et un symbole sacré terni. Adapter le butin au niveau du groupe.',
      },
    ],
  },
  {
    id: 'foret',
    name: 'Forêt',
    generator: 'outdoor',
    seed: 'foret-1',
    params: {
      width: 60,
      height: 60,
      theme: 'temperate',
      forest: 0.9,
      water: 0.15,
      rivers: 1,
      roads: 1,
    },
    theme: 'parchment',
    darkness: 0,
    lights: 'campfire',
    notes: [
      {
        title: 'Sous les arbres',
        body: 'La lumière filtre à peine entre les feuillages. On entend un bruit de branches, au loin.',
      },
      {
        title: 'Le campement',
        body: "Des cendres encore tièdes : quelqu'un est passé ici il y a peu. Des traces mènent vers le sentier.",
      },
    ],
  },
  {
    id: 'grotte',
    name: 'Grotte',
    generator: 'cave',
    seed: 'grotte-1',
    params: { width: 50, height: 50, theme: 'rock', decor: 0.6 },
    theme: 'dark',
    darkness: 0.45,
    lights: 'torch',
    notes: [
      {
        title: "L'entrée de la grotte",
        body: "Un courant d'air froid sort de la galerie. Le sol est glissant.",
      },
      {
        title: 'La caverne centrale',
        body: "Un vaste espace où l'écho porte le moindre bruit. Un repaire possible pour une créature.",
      },
      {
        title: 'Le boyau étroit',
        body: 'Un passage où il faut ramper. Les créatures de taille Grande ne passent pas.',
      },
    ],
  },
];

function pack(): Record<string, PackAsset> {
  const out: Record<string, PackAsset> = {};
  for (const k of PACK_KEYS) out[k.key] = { asset_id: `pack:${k.key}`, url: null, name: k.key };
  return out;
}

function anchors(f: GenFloor, width: number, height: number): [number, number][] {
  const rooms = f.rooms
    .filter((r) => r.rect !== null)
    .sort((a, b) => b.cells - a.cells || a.id - b.id)
    .slice(0, 3)
    .map((r): [number, number] => [r.rect!.x + r.rect!.w / 2, r.rect!.y + r.rect!.h / 2]);
  const extra: [number, number][] = [];
  if (f.entrance !== null) extra.push([f.entrance[0] + 0.5, f.entrance[1] + 0.5]);
  extra.push([width / 2, height / 2], [width / 3, height / 3], [(2 * width) / 3, (2 * height) / 3]);
  return [...rooms, ...extra]
    .slice(0, 3)
    .map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2]);
}

function build(spec: Spec): { file: Record<string, unknown>; stats: Record<string, number> } {
  const result = runGenerator(spec.generator, 1, spec.seed, spec.params);
  const f = result.floors[0]!;
  const doc = new MapDocument({
    grid: {
      width: result.width,
      height: result.height,
      cellPx: 70,
      unitLabel: 'ft',
      unitPerCell: 5,
    },
    floor: FLOOR,
  });
  let n = 0;
  const uid = (): string => `t${++n}`;
  const { command, missing } = bindResult(
    result,
    {
      floor: FLOOR,
      offset: { x: 0, y: 0 },
      view: doc,
      scene: null,
      pack: pack(),
      replace: { tiles: { x: 0, y: 0, w: result.width, h: result.height }, objects: 'none' },
      fallback: fallbackKey,
    },
    uid,
  );
  expect(missing, `${spec.id}: pack keys missing`).toEqual([]);

  const ops: unknown[] = [];
  if (spec.darkness > 0) ops.push({ type: 'map.meta', ambient: { darkness: spec.darkness } });
  ops.push(...command.ops);
  const spots = anchors(f, result.width, result.height);
  const preset = LIGHT_PRESETS[spec.lights];
  spots.forEach(([x, y], i) => {
    ops.push({
      type: 'object.add',
      object: {
        uid: uid(),
        floor: FLOOR,
        type: 'light',
        layer: 'lighting',
        geometry: { x, y },
        props: {
          radius: preset.radius,
          dim_radius: preset.dim_radius,
          color: preset.color,
          intensity: preset.intensity,
          flicker: { ...preset.flicker },
          cone: null,
          enabled: true,
          follows_token: null,
        },
        visibility: 'all',
        locked: false,
        sort_order: i,
        rev: 1,
      },
    });
  });
  spec.notes.forEach((note, i) => {
    const noteUid = `note${i + 1}`;
    ops.push({
      type: 'note.add',
      note: { uid: noteUid, title: note.title, body: note.body, audience: 'gm', read_aloud: false },
    });
    const [x, y] = spots[i % spots.length]!;
    ops.push({
      type: 'object.add',
      object: {
        uid: uid(),
        floor: FLOOR,
        type: 'pin',
        layer: 'props',
        geometry: { x, y },
        props: { icon: 'info', color: '#d9a441', note: noteUid },
        visibility: 'gm',
        locked: false,
        sort_order: 0,
        rev: 1,
      },
    });
  });
  return {
    file: {
      id: spec.id,
      name: spec.name,
      kind: 'battle',
      theme: spec.theme,
      width: result.width,
      height: result.height,
      cell_px: 70,
      unit_label: 'ft',
      unit_per_cell: 5,
      floor: FLOOR,
      generator: { id: spec.generator, seed: spec.seed },
      ops,
    },
    stats: { ops: ops.length, tiles: f.ground.length + f.terrain.length + f.decor.length },
  };
}

describe('built-in templates', () => {
  it('writes app/Domain/Maps/templates', () => {
    registerAllGenerators();
    mkdirSync(OUT, { recursive: true });
    const entries: unknown[] = [];
    for (const spec of SPECS) {
      const { file, stats } = build(spec);
      const json = JSON.stringify(file);
      expect(json.length, `${spec.id} size`).toBeLessThan(500_000);
      expect(stats.tiles).toBeGreaterThan(100);
      writeFileSync(`${OUT}${spec.id}.json`, json + '\n');
      entries.push({ id: spec.id, name: spec.name, file: `${spec.id}.json`, bytes: json.length });
    }
    writeFileSync(
      `${OUT}manifest.json`,
      JSON.stringify({ version: TEMPLATES_VERSION, templates: entries }, null, 2) + '\n',
    );
  });
});
