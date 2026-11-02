import { describe, expect, it } from 'vitest';
import { applyFormat } from '../src/lib/markdown-edit';

describe('applyFormat', () => {
  it('wraps the selection in bold and italic, and takes the markers off again', () => {
    const b = applyFormat('un mot ici', 3, 6, 'bold');
    expect(b).toEqual({ value: 'un **mot** ici', selStart: 5, selEnd: 8 });
    expect(applyFormat(b.value, b.selStart, b.selEnd, 'bold').value).toBe('un mot ici');
    expect(applyFormat('un mot', 3, 6, 'italic').value).toBe('un *mot*');
  });

  it('puts the caret between the markers without selection', () => {
    const r = applyFormat('ab', 1, 1, 'bold');
    expect(r).toEqual({ value: 'a****b', selStart: 3, selEnd: 3 });
  });

  it('prefixes every selected line, and toggles', () => {
    const l = applyFormat('a\nb\nc', 0, 3, 'list');
    expect(l.value).toBe('- a\n- b\nc');
    expect(applyFormat(l.value, l.selStart, l.selEnd, 'list').value).toBe('a\nb\nc');
    expect(applyFormat('a\nb', 0, 3, 'ordered').value).toBe('1. a\n2. b');
    expect(applyFormat('a', 0, 1, 'quote').value).toBe('> a');
    expect(applyFormat('a\nb', 2, 2, 'heading').value).toBe('a\n## b');
    expect(applyFormat('## a', 0, 0, 'heading').value).toBe('a');
  });

  it('switches a bullet list to a numbered list', () => {
    expect(applyFormat('- a\n- b', 0, 7, 'ordered').value).toBe('1. a\n2. b');
  });

  it('inserts a rule on its own line', () => {
    expect(applyFormat('abc', 3, 3, 'rule').value).toBe('abc\n---\n');
    expect(applyFormat('', 0, 0, 'rule').value).toBe('---\n');
  });

  it('clamps an out-of-range selection', () => {
    expect(applyFormat('ab', 9, 20, 'bold').value).toBe('ab****');
  });
});
