import { UsageError } from './errors.js';

export interface ParsedArgs {
  /** First positional (e.g. "tree"), or null when absent. */
  command: string | null;
  /** Positionals after the command (e.g. the inspect query). */
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const VALUE_FLAGS = new Set(['cdp', 'tab', 'depth', 'fields', 'limit']);
const BOOL_FLAGS = new Set(['json', 'compact', 'all', 'help', 'version']);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      let name = arg.slice(2);
      let value: string | undefined;
      const eq = name.indexOf('=');
      if (eq !== -1) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      if (VALUE_FLAGS.has(name)) {
        if (value === undefined) {
          value = argv[++i];
          if (value === undefined) throw new UsageError(`Flag --${name} requires a value.`);
        }
        flags[name] = value;
      } else if (BOOL_FLAGS.has(name)) {
        if (value !== undefined) throw new UsageError(`Flag --${name} does not take a value.`);
        flags[name] = true;
      } else {
        throw new UsageError(`Unknown flag: --${name}`);
      }
    } else {
      positionals.push(arg);
    }
  }

  return { command: positionals[0] ?? null, positionals: positionals.slice(1), flags };
}
