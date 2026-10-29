import { describe, expect, it } from 'vitest';
import { optionForKey, splitMnemonic } from './menu';

const options = [
  { label: 'Rename…', key: 'r' },
  { label: 'Remove heading…', key: 'e' },
  { label: 'Delete project', key: 'd' },
  { label: 'No key' },
];

describe('optionForKey', () => {
  it('finds the option for a letter, ignoring case', () => {
    expect(optionForKey(options, { key: 'e' }, '')?.label).toBe('Remove heading…');
    expect(optionForKey(options, { key: 'D' }, '')?.label).toBe('Delete project');
  });

  it('lets typing filter once a query has started', () => {
    expect(optionForKey(options, { key: 'r' }, 'de')).toBeUndefined();
  });

  it('ignores modified keys, named keys and unknown letters', () => {
    expect(optionForKey(options, { key: 'r', metaKey: true }, '')).toBeUndefined();
    expect(optionForKey(options, { key: 'r', ctrlKey: true }, '')).toBeUndefined();
    expect(optionForKey(options, { key: 'r', altKey: true }, '')).toBeUndefined();
    expect(optionForKey(options, { key: 'Enter' }, '')).toBeUndefined();
    expect(optionForKey(options, { key: 'z' }, '')).toBeUndefined();
  });
});

describe('splitMnemonic', () => {
  it('splits around the first occurrence of the letter', () => {
    expect(splitMnemonic('Rename…', 'r')).toEqual(['', 'R', 'ename…']);
    expect(splitMnemonic('Remove heading…', 'e')).toEqual(['R', 'e', 'move heading…']);
    expect(splitMnemonic('New heading…', 'h')).toEqual(['New ', 'h', 'eading…']);
  });

  it('returns null without a key or when the letter is missing', () => {
    expect(splitMnemonic('Rename…', undefined)).toBeNull();
    expect(splitMnemonic('Rename…', 'z')).toBeNull();
  });
});
