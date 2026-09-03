import type { Ctx } from '../ctx.js';
import { runProbe } from '../probe/index.js';
import type { DomInfo, TreeNode, TreeProbeData } from './tree.js';

export interface FindMatch {
  name: string;
  file: string | null;
  dom: DomInfo | null;
  /** Component chain from the app root down to the match (inclusive). */
  path: Array<{ name: string; file: string | null }>;
}

export interface FindResult {
  command: 'find';
  page: { title: string; url: string };
  data: { matches: FindMatch[] };
}

/** Find components by exact name or case-insensitive source-file substring. */
export function findMatches(roots: TreeNode[], query: string): FindMatch[] {
  const matches: FindMatch[] = [];
  const q = query.toLowerCase();

  const walk = (node: TreeNode, chain: Array<{ name: string; file: string | null }>): void => {
    if (node.kind === 'component' && !node.duplicate) {
      const self = { name: node.name, file: node.file ?? null };
      const chainForSelf = [...chain, self];
      if (node.name === query || (node.file ?? '').toLowerCase().includes(q)) {
        matches.push({ name: node.name, file: node.file ?? null, dom: node.dom ?? null, path: chainForSelf });
      }
      chain = chainForSelf;
    }
    for (const child of node.children ?? []) walk(child, chain);
  };

  for (const root of roots) walk(root, []);
  return matches;
}

export async function runFind(
  ctx: Ctx,
  query: string,
  _flags: Record<string, string | boolean>,
): Promise<FindResult> {
  // Find scans the deepest tree; name/file only, no state fields. React
  // trees interleave component and element levels, so they run deeper than
  // Vue trees — 100 levels covers ~50 layers of component nesting (still
  // bounded by the 5000-node cap).
  const data = (await runProbe(ctx.client, ctx.sessionId, {
    command: 'tree',
    depth: 100,
    fields: [],
  })) as TreeProbeData;
  return {
    command: 'find',
    page: { title: ctx.page.title, url: ctx.page.url },
    data: { matches: findMatches(data.roots, query) },
  };
}
