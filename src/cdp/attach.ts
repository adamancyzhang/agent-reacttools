import type { CdpClient } from './client.js';
import { ArtError } from '../errors.js';
import { evaluateExpression } from '../evaluate.js';
import { isUsablePage } from './discovery.js';

export interface PageInfo {
  /** null when connected at page level (no session needed). */
  sessionId: string | null;
  title: string;
  url: string;
}

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
}

/**
 * Pick the page to inspect.
 * - page-level connection: already scoped to one page; just read title/url.
 * - browser-level connection: list targets, pick per --tab, attach (flatten).
 * --tab selector: t1/t2... (1-based), exact title, or URL substring.
 */
export async function resolvePage(
  client: CdpClient,
  level: 'browser' | 'page',
  tabSel?: string | boolean,
): Promise<PageInfo> {
  if (level === 'page') {
    const title = String((await evaluateExpression(client, 'document.title', null)) ?? '');
    const url = String((await evaluateExpression(client, 'location.href', null)) ?? '');
    return { sessionId: null, title, url };
  }

  const { targetInfos } = (await client.send('Target.getTargets')) as { targetInfos: TargetInfo[] };
  const pages = targetInfos.filter(isUsablePage);
  if (pages.length === 0) {
    throw new ArtError('no-tabs', 'No usable page tabs found in the browser.');
  }

  const sel = typeof tabSel === 'string' ? tabSel : undefined;
  let picked: TargetInfo;
  if (!sel) {
    if (pages.length > 1) {
      const list = pages.map((p, i) => `t${i + 1}: ${p.title || '(untitled)'} — ${p.url}`).join('\n');
      throw new ArtError('ambiguous-tab', `Multiple tabs open. Choose one with --tab:\n${list}`);
    }
    picked = pages[0]!;
  } else {
    let match: TargetInfo | undefined;
    const m = /^t(\d+)$/i.exec(sel);
    if (m) {
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < pages.length) match = pages[idx];
      if (!match) {
        throw new ArtError('bad-tab', `No tab t${m[1]}; there are ${pages.length} tab(s) (t1..t${pages.length}).`);
      }
    } else {
      match = pages.find((p) => p.title === sel) ?? pages.find((p) => p.url.includes(sel));
      if (!match) throw new ArtError('bad-tab', `No tab matches "${sel}".`);
    }
    picked = match;
  }

  const { sessionId } = (await client.send('Target.attachToTarget', {
    targetId: picked.targetId,
    flatten: true,
  })) as { sessionId: string };
  return { sessionId, title: picked.title, url: picked.url };
}
