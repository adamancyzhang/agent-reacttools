import type { Ctx } from '../ctx.js';
import { UsageError } from '../errors.js';
import { runProbe } from '../probe/index.js';
import type { DomInfo } from './tree.js';

export interface QueryMatch {
  dom: DomInfo | null;
  component: { name: string; file: string | null } | null;
}

export interface QueryResult {
  command: 'query';
  page: { title: string; url: string };
  data: { query: string; total: number; truncated: boolean; matches: QueryMatch[] };
}

function parseLimit(input: string | boolean | undefined): number {
  if (input === undefined) return 50;
  if (typeof input !== 'string' || !/^\d+$/.test(input)) {
    throw new UsageError('--limit must be a positive integer.');
  }
  const n = Number(input);
  if (n < 1 || !Number.isSafeInteger(n)) throw new UsageError('--limit must be a positive integer.');
  return n;
}

/** Collect DOM elements matching an XPath expression or CSS selector. */
export async function runQuery(
  ctx: Ctx,
  query: string,
  flags: Record<string, string | boolean>,
): Promise<QueryResult> {
  const limit = parseLimit(flags.limit);
  const data = (await runProbe(ctx.client, ctx.sessionId, {
    command: 'query',
    query,
    limit,
  })) as QueryResult['data'];
  return {
    command: 'query',
    page: { title: ctx.page.title, url: ctx.page.url },
    data,
  };
}
