import type { Ctx } from '../ctx.js';
import { parseFields } from '../fields.js';
import { runProbe } from '../probe/index.js';
import type { DomInfo } from './tree.js';

export interface InspectInstance {
  name: string;
  file: string | null;
  dom: DomInfo | null;
  props?: { defs?: { defaultProps?: Record<string, unknown> }; values?: unknown };
  hooks?: Record<string, unknown>;
  memo?: Record<string, unknown>;
  context?: unknown;
  state?: unknown;
  parentChain: Array<{ name: string; file: string | null }>;
}

export interface InspectResult {
  command: 'inspect';
  page: { title: string; url: string };
  data: { query: string; instances: InspectInstance[] };
}

export async function runInspect(
  ctx: Ctx,
  query: string,
  flags: Record<string, string | boolean>,
): Promise<InspectResult> {
  const fields = parseFields(flags.fields) ?? null; // null = every field
  const data = (await runProbe(ctx.client, ctx.sessionId, {
    command: 'inspect',
    query,
    detail: true,
    fields,
  })) as InspectResult['data'];
  return {
    command: 'inspect',
    page: { title: ctx.page.title, url: ctx.page.url },
    data,
  };
}
