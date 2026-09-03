import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/errors.js';
import { clampDepth, parseFields } from '../../src/fields.js';

describe('parseFields', () => {
  it('returns null for undefined (command default)', () => {
    expect(parseFields(undefined)).toBeNull();
  });

  it('parses comma-separated lists', () => {
    expect(parseFields('props,hooks , memo')).toEqual(['props', 'hooks', 'memo']);
  });

  it('rejects unknown fields', () => {
    expect(() => parseFields('props,nope')).toThrow(UsageError);
    expect(() => parseFields('props,nope')).toThrow(/Unknown field "nope"/);
  });

  it('rejects empty lists', () => {
    expect(() => parseFields(',,')).toThrow(UsageError);
    expect(() => parseFields(true)).toThrow(UsageError);
  });
});

describe('clampDepth', () => {
  it('defaults to 8', () => {
    expect(clampDepth(undefined)).toBe(8);
  });

  it('parses any positive integer (no upper limit)', () => {
    expect(clampDepth('1')).toBe(1);
    expect(clampDepth('50')).toBe(50);
    expect(clampDepth('9999')).toBe(9999);
  });

  it('rejects zero, negative and non-numeric input', () => {
    expect(() => clampDepth('0')).toThrow(/positive integer/);
    expect(() => clampDepth('-5')).toThrow(/positive integer/);
    expect(() => clampDepth('abc')).toThrow(UsageError);
  });
});
