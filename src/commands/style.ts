import type { Ctx } from '../ctx.js';
import { runProbe } from '../probe/index.js';
import type { DomInfo } from './tree.js';

export interface StyleResult {
  command: 'style';
  page: { title: string; url: string };
  data: {
    tag: string;
    id: string | null;
    /** Full class attribute — untruncated, the primary hook for style debugging. */
    class: string | null;
    text: string | null;
    dom: DomInfo | null;
    inline: string | null;
    style: Record<string, string>;
  };
}

/** Dump the computed style of an element (CSS selector or XPath). */
export async function runStyle(
  ctx: Ctx,
  query: string,
  flags: Record<string, string | boolean>,
): Promise<StyleResult> {
  const data = (await runProbe(ctx.client, ctx.sessionId, {
    command: 'style',
    query,
    all: flags.all === true,
  })) as StyleResult['data'];
  return {
    command: 'style',
    page: { title: ctx.page.title, url: ctx.page.url },
    data,
  };
}
