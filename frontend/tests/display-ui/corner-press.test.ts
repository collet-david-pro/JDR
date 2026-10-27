import { describe, expect, it, vi } from 'vitest';
import { CornerPress, cornerAt } from '../../src/lib/displays/corner-press';

const area = { width: 1000, height: 600 };

describe('cornerAt', () => {
  it('finds the four corners (80 px zones)', () => {
    expect(cornerAt(10, 10, area)).toBe('tl');
    expect(cornerAt(990, 10, area)).toBe('tr');
    expect(cornerAt(10, 590, area)).toBe('bl');
    expect(cornerAt(990, 590, area)).toBe('br');
  });
  it('is null outside the zones', () => {
    expect(cornerAt(500, 300, area)).toBeNull();
    expect(cornerAt(81, 10, area)).toBeNull();
    expect(cornerAt(10, 81, area)).toBeNull();
  });
});

describe('CornerPress', () => {
  function setup() {
    vi.useFakeTimers();
    const onTrigger = vi.fn();
    const press = new CornerPress({ onTrigger });
    return { press, onTrigger };
  }

  it('triggers after 2 s in a corner', () => {
    const { press, onTrigger } = setup();
    press.down(1, 20, 20, area);
    vi.advanceTimersByTime(1999);
    expect(onTrigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTrigger).toHaveBeenCalledWith('tl');
    vi.useRealTimers();
  });

  it('does nothing outside a corner', () => {
    const { press, onTrigger } = setup();
    press.down(1, 500, 300, area);
    vi.advanceTimersByTime(5000);
    expect(onTrigger).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('is cancelled by a release or a move beyond 10 px, not by a small move', () => {
    const { press, onTrigger } = setup();
    press.down(1, 20, 20, area);
    press.move(1, 25, 25);
    expect(press.pressing).toBe(true);
    press.move(1, 40, 20);
    expect(press.pressing).toBe(false);
    press.down(2, 990, 590, area);
    vi.advanceTimersByTime(1000);
    press.up(2);
    vi.advanceTimersByTime(5000);
    expect(onTrigger).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a second finger cancels', () => {
    const { press, onTrigger } = setup();
    press.down(1, 20, 20, area);
    press.down(2, 500, 300, area);
    vi.advanceTimersByTime(5000);
    expect(onTrigger).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
