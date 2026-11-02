import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MapCard from '../../src/components/maps/MapCard.svelte';
import SaveTemplateDialog from '../../src/components/maps/SaveTemplateDialog.svelte';
import TemplatePickerDialog from '../../src/components/maps/TemplatePickerDialog.svelte';
import {
  PRIVATE_ASSETS,
  TemplatesClient,
  templateSections,
  type MapTemplate,
} from '../../src/lib/maps/templates';
import { setServices } from '../../src/lib/services';
import { json, mockApi, noContent, ok } from '../fixtures/games';
import { makeMap, makeSummary } from './fixtures';

function tpl(over: Partial<MapTemplate> = {}): MapTemplate {
  return {
    id: '1',
    name: 'Taverne',
    scope: 'site',
    builtin: true,
    kind: 'battle',
    width: 44,
    height: 44,
    floors: 1,
    notes: 3,
    owned: false,
    can_delete: false,
    ...over,
  };
}

function call(fetchMock: ReturnType<typeof mockApi>['fetchMock'], index = 0) {
  const init = fetchMock.mock.calls[index]?.[1] ?? {};
  return {
    url: String(fetchMock.mock.calls[index]?.[0]),
    method: init.method,
    body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

describe('TemplatesClient', () => {
  it('lists, saves, instantiates and deletes', async () => {
    const { api, fetchMock } = mockApi((url, init) => {
      if (init.method === 'DELETE') return noContent();
      if (url.endsWith('/templates')) return json(ok([tpl()]));
      if (url.endsWith('/save-as-template'))
        return json(ok(tpl({ id: '9', scope: 'private' })), 201);
      return json(ok(makeMap()), 201);
    });
    const client = new TemplatesClient(api);
    expect(await client.list()).toEqual([tpl()]);
    expect((await client.save('11', { name: 'Mon modèle', scope: 'private' })).id).toBe('9');
    expect((await client.instantiate('a/b', { game_id: '7', name: 'Neuve' })).id).toBe(
      makeMap().id,
    );
    await client.remove('9');
    expect(call(fetchMock, 0)).toMatchObject({ url: '/api/v1/templates', method: 'GET' });
    expect(call(fetchMock, 1)).toMatchObject({
      url: '/api/v1/maps/11/save-as-template',
      method: 'POST',
      body: { name: 'Mon modèle', scope: 'private' },
    });
    expect(call(fetchMock, 2)).toMatchObject({
      url: '/api/v1/templates/a%2Fb/instantiate',
      body: { game_id: '7', name: 'Neuve' },
    });
    expect(call(fetchMock, 3)).toMatchObject({ url: '/api/v1/templates/9', method: 'DELETE' });
  });

  it('names the refusal code of private assets', () => {
    expect(PRIVATE_ASSETS).toBe('private_assets');
  });
});

describe('templateSections', () => {
  it('puts built-in and site templates first, then the private ones, sorted', () => {
    const sections = templateSections([
      tpl({ id: '5', name: 'Zèbre', scope: 'private', builtin: false, owned: true }),
      tpl({ id: '4', name: 'Atelier', scope: 'site', builtin: false }),
      tpl({ id: '2', name: 'Grotte' }),
      tpl({ id: '3', name: 'Crypte' }),
      tpl({ id: '6', name: 'Arbre', scope: 'private', builtin: false, owned: true }),
    ]);
    expect(sections.shared.map((x) => x.name)).toEqual(['Crypte', 'Grotte', 'Atelier']);
    expect(sections.mine.map((x) => x.name)).toEqual(['Arbre', 'Zèbre']);
  });

  it('handles an empty list', () => {
    expect(templateSections([])).toEqual({ shared: [], mine: [] });
  });
});

describe('template dialogs and card', () => {
  const noop = (): void => undefined;
  setServices({ api: {}, boot: {}, router: { href: (path: string) => path }, auth: {} } as never);

  it('offers "save as template" on a card only when the handler is given', () => {
    const base = { map: makeSummary(), trash: false, busy: false };
    const handlers = { onedit: noop, onduplicate: noop, ontrash: noop, onrestore: noop };
    const without = render(MapCard, { props: { ...base, ...handlers } }).body;
    const withIt = render(MapCard, { props: { ...base, ...handlers, onsavetemplate: noop } }).body;
    expect(without).not.toContain('data-testid="map-save-template"');
    expect(withIt).toContain('data-testid="map-save-template"');
  });

  it('shows the scope choice to admins only', () => {
    const props = {
      open: true,
      map: makeSummary(),
      onsave: () => Promise.reject(new Error('unused')),
      onsaved: noop,
    };
    const user = render(SaveTemplateDialog, { props: { ...props, admin: false } }).body;
    const admin = render(SaveTemplateDialog, { props: { ...props, admin: true } }).body;
    expect(user).toContain('data-testid="template-save"');
    expect(user).not.toContain('name="scope"');
    expect(admin).toContain('name="scope"');
  });

  it('renders the picker with its create button disabled until a template is picked', () => {
    const body = render(TemplatePickerDialog, {
      props: {
        open: true,
        list: () => Promise.resolve([]),
        create: () => Promise.reject(new Error('unused')),
        remove: () => Promise.resolve(),
        oncreated: noop,
      },
    }).body;
    expect(body).toContain('data-testid="template-picker"');
    expect(body).toMatch(/<button[^>]*data-testid="template-create"[^>]*disabled/);
  });
});
