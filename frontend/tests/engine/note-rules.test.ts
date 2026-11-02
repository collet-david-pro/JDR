import { describe, expect, it } from 'vitest';
import { shadowSegments } from '../../src/engine/scene/shadows';
import { objectAlpha, objectShown, secretDrawnAsWall } from '../../src/engine/scene/view-rules';
import { isOccluder } from '../../src/engine/scene/scene-diff';
import { passage, pin, secretRoom, trap, zone } from '../editor/note-helpers';

const room = secretRoom('r', [
  [1, 1],
  [4, 1],
  [4, 4],
]);
const all = [
  pin('p', 1, 1),
  zone('z', [
    [1, 1],
    [4, 1],
    [4, 4],
  ]),
  trap('t', 2, 2),
  room,
];

describe('view rules of the notes family', () => {
  it('the GM sees everything, dimmed (visibility ≠ all)', () => {
    for (const o of [...all, passage('s', [0, 0], [3, 0])]) {
      expect(objectShown(o, 'gm')).toBe(true);
      expect(objectAlpha(o, 'gm')).toBeLessThan(1);
    }
  });

  it('players and displays do not get pins, zones, traps nor secret rooms', () => {
    for (const mode of ['player', 'display'] as const) {
      for (const o of all) expect(objectShown(o, mode)).toBe(false);
    }
  });

  it('a pin that follows a visible note (visibility all) is drawn for the players', () => {
    expect(objectShown({ ...pin('p', 1, 1), visibility: 'all' }, 'player')).toBe(true);
  });

  it('a secret passage is drawn as a plain wall for players and displays, not for the GM', () => {
    const s = passage('s', [0, 0], [3, 0]);
    expect(secretDrawnAsWall(s, 'player')).toBe(true);
    expect(secretDrawnAsWall(s, 'display')).toBe(true);
    expect(secretDrawnAsWall(s, 'gm')).toBe(false);
    expect(objectShown(s, 'player')).toBe(true);
    expect(secretDrawnAsWall(room, 'player')).toBe(false);
  });

  it('only the passage is an occluder and casts a shadow, and only outside the GM view', () => {
    expect(isOccluder(passage('s', [0, 0], [3, 0]))).toBe(true);
    for (const o of all) expect(isOccluder(o)).toBe(false);
    const s = passage('s', [0, 0], [3, 0]);
    expect(shadowSegments([s], 'gm')).toEqual([]);
    expect(shadowSegments([s], 'player')).toHaveLength(1);
    expect(shadowSegments(all, 'player')).toEqual([]);
  });
});
