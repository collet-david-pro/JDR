import { describe, expect, it } from 'vitest';
import { feedbackUrl, routePattern, validRepoUrl } from '../src/lib/feedback';
import { parseBootConfig } from '../src/lib/boot';

const REPO = 'https://github.com/collet-david-pro/JDR';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/130.0';

describe('feedbackUrl', () => {
  it('builds a pre-filled issue form URL', () => {
    const url = feedbackUrl({
      repo: REPO,
      kind: 'bug',
      version: '0.2.0',
      userAgent: UA,
      pattern: '/games/:id/maps/:mapId/edit',
    });
    expect(url).toBe(
      `${REPO}/issues/new?template=bug.yml&version=0.2.0&browser=Firefox+%C2%B7+macOS&page=%2Fgames%2F%3Aid%2Fmaps%2F%3AmapId%2Fedit`,
    );
    const parsed = new URL(url ?? '');
    expect(parsed.searchParams.get('browser')).toBe('Firefox · macOS');
    expect(parsed.searchParams.get('page')).toBe('/games/:id/maps/:mapId/edit');
  });

  it('uses the idea form', () => {
    const url = feedbackUrl({
      repo: REPO,
      kind: 'idea',
      version: 'dev',
      userAgent: '',
      pattern: '/',
    });
    expect(new URL(url ?? '').searchParams.get('template')).toBe('idea.yml');
  });

  it('encodes odd values and never sends the full user agent', () => {
    const url = feedbackUrl({
      repo: REPO,
      kind: 'bug',
      version: '1.0 &x=1#frag',
      userAgent: UA,
      pattern: '/join/:code?',
    });
    const parsed = new URL(url ?? '');
    expect(parsed.searchParams.get('version')).toBe('1.0 &x=1#frag');
    expect(parsed.hash).toBe('');
    expect(url).not.toContain('Mozilla');
    expect(url).not.toContain('10_15');
  });

  it('returns null without a valid repository', () => {
    const base = { kind: 'bug', version: '1', userAgent: UA, pattern: '/' } as const;
    expect(feedbackUrl({ ...base, repo: '' })).toBeNull();
    expect(feedbackUrl({ ...base, repo: 'https://evil.example/a/b' })).toBeNull();
    expect(feedbackUrl({ ...base, repo: 'javascript:alert(1)' })).toBeNull();
  });
});

describe('routePattern', () => {
  it('keeps declared patterns, which hold no identifier', () => {
    for (const p of [
      '/',
      '/join/:code?',
      '/display',
      '/sessions/:id',
      '/invite/:code',
      '/reset/:token',
      '/admin/*',
    ]) {
      expect(routePattern(p)).toBe(p);
    }
  });

  it('rejects anything that is not a plain pattern', () => {
    expect(routePattern(null)).toBe('inconnue');
    expect(routePattern(undefined)).toBe('inconnue');
    expect(routePattern('https://jdr.example.org/x')).toBe('inconnue');
    expect(routePattern('/games/12?token=abc')).toBe('inconnue');
    expect(routePattern('/a b')).toBe('inconnue');
  });

  it('never carries a concrete id, code, token or query in the URL', () => {
    const url = feedbackUrl({
      repo: REPO,
      kind: 'bug',
      version: '1',
      userAgent: UA,
      pattern: '/join/:code?',
    });
    expect(url).not.toMatch(/ABCD|token=|%3Fcode=/);
  });
});

describe('validRepoUrl', () => {
  it('accepts only https://github.com/<owner>/<repo>', () => {
    expect(validRepoUrl(REPO)).toBe(REPO);
    expect(validRepoUrl(` ${REPO} `)).toBe(REPO);
    for (const bad of [
      'http://github.com/a/b',
      'https://github.com/a',
      'https://github.com/a/b/',
      'https://github.com/a/b/issues',
      'https://github.com/a/..',
      'https://github.com.evil.org/a/b',
      'https://gitlab.com/a/b',
      '',
    ]) {
      expect(validRepoUrl(bad)).toBeNull();
    }
  });
});

describe('boot feedback_url', () => {
  const base = { version: '1', routing_mode: 'rewrite', base_path: '', api_base: '/api/v1' };
  it('reads a valid address and drops an invalid or missing one', () => {
    expect(parseBootConfig(JSON.stringify({ ...base, feedback_url: REPO })).feedbackUrl).toBe(REPO);
    expect(
      parseBootConfig(JSON.stringify({ ...base, feedback_url: 'http://x/y' })).feedbackUrl,
    ).toBe('');
    expect(parseBootConfig(JSON.stringify(base)).feedbackUrl).toBe('');
  });
});
