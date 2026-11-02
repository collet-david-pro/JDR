import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MarkdownEditor from '../../src/components/MarkdownEditor.svelte';
import NoteDialog from '../../src/components/editor/NoteDialog.svelte';
import NotesPanel from '../../src/components/editor/NotesPanel.svelte';
import { isTypingTarget } from '../../src/editor/shortcuts';
import { noteAddCommand } from '../../src/editor/model/note-commands';
import { rejectionText } from '../../src/editor/sync/rejection-text';
import { draftOf, draftValues, emptyDraft, validateDraft } from '../../src/editor/ui/note-form';
import { setServices } from '../../src/lib/services';
import { EditorSession } from '../../src/editor/ui/session';
import { grid } from './helpers';

const FORMATS = ['heading', 'bold', 'italic', 'list', 'ordered', 'quote', 'rule'];

describe('MarkdownEditor', () => {
  const html = (value: string, extra: Record<string, unknown> = {}): string =>
    render(MarkdownEditor, { props: { value, label: 'Texte', ...extra } }).body;

  it('has the seven format buttons, the Write / Preview switch and the counter', () => {
    const out = html('un **mot**');
    for (const f of FORMATS) expect(out).toContain(`data-testid="md-${f}"`);
    expect(out).toContain('data-testid="md-write"');
    expect(out).toContain('data-testid="md-preview"');
    expect(out).toContain('maxlength="20000"');
    // Every button has an accessible name.
    const buttons = [...out.matchAll(/<button[^>]*data-testid="md-(?!write|preview)[^>]*>/g)];
    expect(buttons).toHaveLength(7);
    for (const b of buttons) expect(b[0]).toContain('aria-label=');
  });

  it('renders the preview with the safe renderer: no element from the body', () => {
    const out = html('<img src=x onerror=alert(1)>\n\n**gras**');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('<strong>gras</strong>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)>');
  });

  it('shows the count and the custom limit', () => {
    const out = html('abc', { maxlength: 50 });
    expect(out).toContain('maxlength="50"');
    expect(out).toContain('aria-live="polite"');
  });
});

describe('note form', () => {
  it('validates title, body and audience', () => {
    const d = emptyDraft();
    expect(validateDraft(d, true)).toEqual({ title: 'required' });
    d.title = 'A'.repeat(121);
    expect(validateDraft(d, true).title).toBe('too_long');
    d.title = 'ok';
    d.body = 'x'.repeat(20_001);
    expect(validateDraft(d, true).body).toBe('too_long');
    d.body = '';
    d.audience = 'players';
    expect(validateDraft(d, true).audience_users).toBe('required');
    expect(validateDraft(d, false).audience_users).toBe('required');
    d.audience_users = ['u1'];
    expect(validateDraft(d, true)).toEqual({});
  });

  it('sends the trimmed title and no audience users unless the audience is players', () => {
    const d = {
      ...emptyDraft(),
      title: '  Salle  ',
      audience: 'all' as const,
      audience_users: ['u1'],
    };
    expect(draftValues(d)).toMatchObject({ title: 'Salle', audience: 'all', audience_users: [] });
  });
});

describe('editor shortcuts and the Markdown field', () => {
  it('ignores the shortcuts of the editor while typing in a text area', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
  });
});

describe('refused batches', () => {
  const t = (key: string): string => key;
  it('says what the server refused for the notes', () => {
    expect(
      rejectionText({ code: 'validation_failed', fields: { 'ops.0.note.title': 'required' } }, t),
    ).toBe('validation.required');
    expect(rejectionText({ code: 'validation_failed', fields: { 'ops.1': 'limit' } }, t)).toBe(
      'validation.limit',
    );
    expect(
      rejectionText(
        { code: 'validation_failed', fields: { 'ops.2.note.audience_users': 'not_member' } },
        t,
      ),
    ).toBe('validation.not_member');
    expect(
      rejectionText({ code: 'validation_failed', fields: { 'ops.0.patch.body': 'too_long' } }, t),
    ).toBe('validation.too_long');
  });

  it('falls back to the generic text', () => {
    expect(
      rejectionText({ code: 'validation_failed', fields: { 'ops.0.cells.1': 'invalid' } }, t),
    ).toBe('editor.save.errors.rejected');
    expect(rejectionText({ code: 'forbidden' }, t)).toBe('editor.save.errors.rejected');
  });
});

describe('NoteDialog and NotesPanel (server render)', () => {
  setServices({ api: {}, boot: {}, router: {}, auth: {} } as never);
  const session = (): EditorSession => new EditorSession({ grid: grid(20, 20) });

  it('offers the three audiences with a game, and only two without', () => {
    const s = session();
    const withGame = render(NoteDialog, {
      props: { open: true, session: s, gameId: 'g1', note: null },
    }).body;
    for (const a of ['gm', 'players', 'all'])
      expect(withGame).toContain(`data-testid="audience-${a}"`);
    const noGame = render(NoteDialog, {
      props: { open: true, session: s, gameId: null, note: null },
    }).body;
    expect(noGame).toContain('data-testid="audience-gm"');
    expect(noGame).toContain('data-testid="audience-all"');
    expect(noGame).not.toContain('data-testid="audience-players"');
    expect(noGame).toContain('data-testid="md-input"');
  });

  it('lists the notes, with a search field only above 10 notes', () => {
    const s = session();
    for (let i = 0; i < 3; i++) {
      s.history.execute(
        noteAddCommand({
          uid: `n${i}`,
          title: `Note ${i}`,
          body: '',
          audience: i === 0 ? 'all' : 'gm',
        }),
      );
    }
    const few = render(NotesPanel, { props: { session: s, gameId: null } }).body;
    expect(few).toContain('Note 0');
    expect(few).toContain('data-audience="all"');
    expect(few).not.toContain('data-testid="note-search"');
    expect(few).toContain('data-testid="secrets-reset"');
    for (let i = 3; i < 12; i++) {
      s.history.execute(noteAddCommand({ uid: `n${i}`, title: `Note ${i}`, body: '' }));
    }
    const many = render(NotesPanel, { props: { session: s, gameId: null } }).body;
    expect(many).toContain('data-testid="note-search"');
  });

  it('draftOf copies a note', () => {
    expect(
      draftOf({
        uid: 'n',
        title: 'T',
        body: 'B',
        asset_id: '5',
        audience: 'players',
        audience_users: ['u'],
        read_aloud: true,
      }),
    ).toEqual({
      title: 'T',
      body: 'B',
      asset_id: '5',
      audience: 'players',
      audience_users: ['u'],
      read_aloud: true,
    });
  });
});
