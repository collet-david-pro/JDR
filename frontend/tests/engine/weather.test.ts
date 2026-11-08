import { describe, expect, it } from 'vitest';
import {
  WEATHER_FADE_S,
  WEATHER_PROFILES,
  WeatherFader,
  createParticleBuffers,
  particleCount,
  seedParticles,
  stepParticles,
} from '../../src/engine/scene/weather-state';
import { RENDER_PIPELINE, pipelineIndex } from '../../src/engine/scene/pipeline';

const HD = 1920 * 1080;

describe('particleCount', () => {
  it('is 0 without weather or intensity', () => {
    expect(particleCount('none', 1, HD)).toBe(0);
    expect(particleCount('rain', 0, HD)).toBe(0);
    expect(particleCount('rain', 1, 0)).toBe(0);
  });
  it('grows with intensity and area, and is capped', () => {
    const lo = particleCount('rain', 0.2, HD);
    const hi = particleCount('rain', 0.6, HD);
    expect(hi).toBeGreaterThan(lo);
    expect(particleCount('rain', 0.5, HD / 4)).toBeLessThan(particleCount('rain', 0.5, HD));
    for (const t of ['rain', 'snow', 'fog', 'storm'] as const) {
      expect(particleCount(t, 1, 100 * HD)).toBe(WEATHER_PROFILES[t].cap);
    }
  });
});

describe('stepParticles', () => {
  it('moves in place, wraps inside the viewport margin and allocates no buffer', () => {
    const buf = createParticleBuffers(50);
    seedParticles(buf, 800, 600);
    const x = buf.x;
    stepParticles(buf, 'rain', 50, 0.016, 800, 600, 30, -10, 1);
    expect(buf.x).toBe(x);
    for (let i = 0; i < 400; i++) stepParticles(buf, 'snow', 50, 0.05, 800, 600, 5, 5, i);
    for (let i = 0; i < 50; i++) {
      expect(buf.x[i]!).toBeGreaterThanOrEqual(-120);
      expect(buf.x[i]!).toBeLessThan(920);
      expect(buf.y[i]!).toBeGreaterThanOrEqual(-120);
      expect(buf.y[i]!).toBeLessThan(720);
    }
  });
  it('makes rain fall and snow fall slower', () => {
    const a = createParticleBuffers(1);
    const b = createParticleBuffers(1);
    stepParticles(a, 'rain', 1, 0.05, 1000, 1000, 0, 0, 0);
    stepParticles(b, 'snow', 1, 0.05, 1000, 1000, 0, 0, 0);
    expect(a.y[0]!).toBeGreaterThan(b.y[0]!);
  });
});

describe('WeatherFader', () => {
  it('jumps when not animated (reduced motion)', () => {
    const f = new WeatherFader();
    f.set('rain', 0.8, false);
    expect(f.type).toBe('rain');
    expect(f.level).toBe(0.8);
    expect(f.step(0.016)).toBe(false);
  });
  it('fades out the old type then fades in the new one', () => {
    const f = new WeatherFader();
    f.set('rain', 1, false);
    f.set('snow', 0.5, true);
    f.step(0.04);
    expect(f.type).toBe('rain');
    expect(f.level).toBeLessThan(1);
    let guard = 0;
    while (f.step(0.05) && guard++ < 1000);
    expect(f.type).toBe('snow');
    expect(f.level).toBe(0.5);
    expect(guard * 0.05).toBeLessThan(WEATHER_FADE_S * 2 + 0.5);
  });
  it('ignores unknown types and shows nothing at intensity 0', () => {
    const f = new WeatherFader();
    f.set('hail' as never, 1, false);
    expect(f.visible).toBe(false);
    f.set('fog', 0, false);
    expect(f.visible).toBe(false);
  });
});

describe('pipeline', () => {
  it('draws weather over the fog and under the grid', () => {
    expect(pipelineIndex('weather')).toBeGreaterThan(pipelineIndex('fog'));
    expect(pipelineIndex('weather')).toBeLessThan(pipelineIndex('grid'));
    expect(RENDER_PIPELINE).toContain('weather');
  });
});
