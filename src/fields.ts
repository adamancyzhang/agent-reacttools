import { UsageError } from './errors.js';

export const FIELDS = ['props', 'hooks', 'memo', 'context', 'state', 'file', 'dom'] as const;

export type Field = (typeof FIELDS)[number];

/** Parse --fields; null means "use the command's default set". */
export function parseFields(input: string | boolean | undefined): Field[] | null {
  if (input === undefined) return null;
  if (typeof input !== 'string' || input.trim() === '') {
    throw new UsageError(`--fields requires a comma-separated list. Valid: ${FIELDS.join(', ')}`);
  }
  const parts = input.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new UsageError(`--fields requires a comma-separated list. Valid: ${FIELDS.join(', ')}`);
  }
  for (const p of parts) {
    if (!(FIELDS as readonly string[]).includes(p)) {
      throw new UsageError(`Unknown field "${p}". Valid: ${FIELDS.join(', ')}`);
    }
  }
  return parts as Field[];
}

/** Parse --depth; defaults to 8, no upper limit (bounded by the node cap). */
export function clampDepth(input: string | boolean | undefined): number {
  if (input === undefined) return 8;
  if (typeof input !== 'string' || !/^\d+$/.test(input)) {
    throw new UsageError('--depth must be a positive integer.');
  }
  const n = Number(input);
  if (n < 1 || !Number.isSafeInteger(n)) throw new UsageError('--depth must be a positive integer.');
  return n;
}
