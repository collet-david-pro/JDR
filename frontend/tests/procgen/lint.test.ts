import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const bad = [
  'export const a = Math.random();',
  'export const a = Math.sin(1);',
  'export const a = Date.now();',
  'export const a = new Date();',
  'export const a = performance.now();',
  'export const a = 2 ** 3;',
  'export const a = (b: Uint8Array) => crypto.getRandomValues(b);',
  'export const a = Math.hypot(1, 2);',
];

describe('procgen lint guard', () => {
  it('flags forbidden constructs under src/procgen and allows the others', async () => {
    const eslint = new ESLint({ cwd });
    for (const code of bad) {
      const [res] = await eslint.lintText(code, { filePath: join(cwd, 'src/procgen/x.ts') });
      expect(res!.messages.length, code).toBeGreaterThan(0);
    }
    const [ok] = await eslint.lintText('export const a = Math.sqrt(4) + Math.floor(1.5);\n', {
      filePath: join(cwd, 'src/procgen/x.ts'),
    });
    expect(ok!.messages).toEqual([]);
    const [elsewhere] = await eslint.lintText('export const a = Math.sin(1);\n', {
      filePath: join(cwd, 'src/other.ts'),
    });
    expect(elsewhere!.messages).toEqual([]);
  }, 30000);

  it('accepts trigonometry in textures/ and sprites/ but still refuses entropy and clock', async () => {
    const eslint = new ESLint({ cwd });
    for (const dir of ['textures', 'sprites']) {
      const filePath = join(cwd, `src/procgen/${dir}/x.ts`);
      const [trig] = await eslint.lintText(
        'export const a = Math.sin(1) + Math.pow(2, 3) + 2 ** 2;\n',
        { filePath },
      );
      expect(trig!.messages, dir).toEqual([]);
      for (const code of [
        'export const a = Math.random();',
        'export const a = Date.now();',
        'export const a = new Date();',
        'export const a = performance.now();',
        'export const a = (b: Uint8Array) => crypto.getRandomValues(b);',
      ]) {
        const [res] = await eslint.lintText(code, { filePath });
        expect(res!.messages.length, `${dir}: ${code}`).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it('no procgen source uses a forbidden call (grep fallback)', () => {
    const dir = join(cwd, 'src/procgen');
    const re =
      /Math\.(random|sin|cos|tan|atan2?|exp|log\d*|pow|hypot|cbrt)\b|Date\.now|performance\.now|getRandomValues/;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      expect(re.test(readFileSync(join(dir, f), 'utf8')), f).toBe(false);
    }
  });
});
