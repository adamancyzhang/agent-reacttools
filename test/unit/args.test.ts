import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/args.js';
import { UsageError } from '../../src/errors.js';

describe('parseArgs', () => {
  it('splits command, positionals and flags', () => {
    const parsed = parseArgs(['inspect', 'Counter', '--json', '--depth', '5']);
    expect(parsed.command).toBe('inspect');
    expect(parsed.positionals).toEqual(['Counter']);
    expect(parsed.flags).toEqual({ json: true, depth: '5' });
  });

  it('supports --flag=value', () => {
    const parsed = parseArgs(['tree', '--depth=3', '--cdp=9222']);
    expect(parsed.flags).toEqual({ depth: '3', cdp: '9222' });
  });

  it('supports -- terminator', () => {
    const parsed = parseArgs(['inspect', '--', '--weird-query']);
    expect(parsed.command).toBe('inspect');
    expect(parsed.positionals).toEqual(['--weird-query']);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['tree', '--nope'])).toThrow(UsageError);
    expect(() => parseArgs(['tree', '--nope'])).toThrow(/Unknown flag/);
  });

  it('rejects value flags without a value', () => {
    expect(() => parseArgs(['tree', '--cdp'])).toThrow(/requires a value/);
  });

  it('rejects values on boolean flags', () => {
    expect(() => parseArgs(['tree', '--json=yes'])).toThrow(/does not take a value/);
  });

  it('returns null command for empty argv', () => {
    expect(parseArgs([]).command).toBeNull();
  });
});
