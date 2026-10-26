import { describe, expect, it } from 'vitest';
import { fogOps } from '../../src/editor/model/fog-wire';
import { MapSync } from '../../src/editor/sync/MapSync';
import { gridOf, tokenDefFromWire } from '../../src/editor/sync/wire';
import { EditorSession } from '../../src/editor/ui/session';
import {
  createFogBitmap,
  encodeFog,
  fogToBase64,
  getFogBit,
  setFogBit,
} from '../../src/formats/fog-codec';
import { MemoryChunkCacheStore, MemoryPendingOpsStore } from '../../src/lib/persistence/map-stores';
import type { MapOpsResult, Token } from '../../src/lib/types';
import { fogRasterizers } from '../../src/vision/index';
import { light, placed, wall } from '../editor/scene-helpers';
import { makeMap } from './fixtures';

describe('MapSync P5 loading', () => {
  it('loads objects, placed tokens and fog, then replays the local fog ops on top', async () => {
    const map = makeMap({
      id: 'm1',
      floors: [{ id: 'f1', level: 0, name: 'RdC', sort_order: 0 }],
      objects: [
        wall('w', [
          [0, 0],
          [4, 0],
        ]),
        { ...light('l', 2, 2), floor: 'other' },
      ],
      tokens_placed: [placed('k', 1.5, 1.5)],
      ambient: {
        darkness: 0.4,
        tint: null,
        time_of_day: '18:30',
        weather: { type: 'rain', intensity: 0.5 },
      },
    });
    const session = new EditorSession({
      grid: gridOf(map),
      floor: 'f1',
      ambient: map.ambient,
      editable: false,
    });
    expect(session.doc.ambient).toMatchObject({
      darkness: 0.4,
      tint: '#000000',
      time_of_day: 18.5,
    });
    const stores = { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() };
    await stores.pending.put({
      mapId: 'm1',
      seq: 1,
      clientOpId: 'left',
      ops: fogOps('fog.reveal', 'f1', fogRasterizers.rect(10, 0, 1, 1, 40, 30)),
      baseRevision: null,
      sealed: false,
    });
    const bits = createFogBitmap();
    setFogBit(bits, 0, 0);
    const data = fogToBase64((await encodeFog(bits))!);
    const sent: unknown[] = [];
    const sync = new MapSync({
      session,
      map,
      stores,
      client: {
        chunks: () => Promise.resolve({ records: [], revision: 0 }),
        sendOps: (_id, body): Promise<MapOpsResult> => {
          sent.push(body);
          return Promise.resolve({ revision: 1, applied: body.ops.length, conflicts: [] });
        },
        fog: () => Promise.resolve({ floor: 'f1', chunks: [[0, 0, data]] }),
      },
    });
    const started = await sync.start(null);
    expect(started.fogErrors).toBe(0);
    expect(started.replayed).toBe(1);
    expect(session.doc.objects().map((o) => o.uid)).toEqual(['w']);
    expect(session.doc.tokens().map((t) => t.uid)).toEqual(['k']);
    const loaded = session.doc.fogChunk('0:0')!;
    expect(getFogBit(loaded, 0, 0)).toBe(true); // server
    expect(getFogBit(loaded, 41, 1)).toBe(true); // replayed
    await sync.settle();
    expect(sent).toHaveLength(1);
    sync.dispose();
  });

  it('counts a failed fog request and keeps going', async () => {
    const map = makeMap({ id: 'm2', floors: [{ id: 'f1', level: 0, name: 'RdC', sort_order: 0 }] });
    const session = new EditorSession({ grid: gridOf(map), floor: 'f1', editable: false });
    const sync = new MapSync({
      session,
      map,
      stores: { pending: new MemoryPendingOpsStore(), chunks: new MemoryChunkCacheStore() },
      client: {
        chunks: () => Promise.resolve({ records: [], revision: 0 }),
        sendOps: () => Promise.resolve({ revision: 1, conflicts: [] }),
        fog: () => Promise.reject(new Error('down')),
      },
    });
    const started = await sync.start(null);
    expect(started.fogErrors).toBe(-1);
    expect(session.ui.editable).toBe(true);
    sync.dispose();
  });
});

describe('wire: token definitions', () => {
  it('maps GET /games/{id}/tokens to TokenDefView', () => {
    const token: Token = {
      id: '5',
      game_id: '7',
      name: 'Aria',
      asset_id: null,
      image: { full: '/f', thumb: '/t' },
      kind: 'pc',
      size_w: 2,
      size_h: 1,
      default_owner_user_id: null,
      vision: { enabled: true, range: 12, dark: 6 },
      light: { radius: 4, dim_radius: 8, color: '#ffffff', intensity: 1, flicker: true },
      ring_color: '#ff0000',
      created_at: '',
      updated_at: '',
    };
    expect(tokenDefFromWire(token)).toEqual({
      id: '5',
      name: 'Aria',
      imageUrl: '/f',
      sizeW: 2,
      sizeH: 1,
      ringColor: '#ff0000',
      kind: 'pc',
      vision: { enabled: true, range: 12, dark: 6 },
      light: { radius: 4, dim_radius: 8, color: '#ffffff', intensity: 1, flicker: true },
    });
  });
});
