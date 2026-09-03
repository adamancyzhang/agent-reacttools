import type { Ctx } from '../ctx.js';
import { clampDepth, parseFields, type Field } from '../fields.js';
import { runProbe } from '../probe/index.js';

export interface DomInfo {
  tag: string;
  id?: string;
  class?: string;
  text?: string;
}

export interface TreeNode {
  kind: 'component' | 'element' | 'fragment' | 'text' | 'comment' | string;
  name: string;
  file?: string | null;
  dom?: DomInfo | null;
  props?: unknown;
  hooks?: Record<string, unknown>;
  memo?: Record<string, unknown>;
  context?: unknown;
  state?: unknown;
  duplicate?: boolean;
  noInstance?: boolean;
  children?: TreeNode[];
}

export interface TreeProbeData {
  version: string | null;
  apps: number;
  truncated: boolean;
  roots: TreeNode[];
}

export interface TreeResult {
  command: 'tree';
  page: { title: string; url: string };
  react: TreeProbeData;
  data: { roots: TreeNode[] };
}

/** Fields shown by default in tree output (probe + text renderer). */
export const TREE_DEFAULT_FIELDS: Field[] = ['props', 'hooks', 'file', 'dom'];

export async function runTree(ctx: Ctx, flags: Record<string, string | boolean>): Promise<TreeResult> {
  const depth = clampDepth(flags.depth);
  const fields = parseFields(flags.fields) ?? TREE_DEFAULT_FIELDS;
  const data = (await runProbe(ctx.client, ctx.sessionId, { command: 'tree', depth, fields })) as TreeProbeData;
  return {
    command: 'tree',
    page: { title: ctx.page.title, url: ctx.page.url },
    react: data,
    data: { roots: data.roots },
  };
}
