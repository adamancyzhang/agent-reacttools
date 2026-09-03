import { ArtError } from '../errors.js';
import { CdpClient } from './client.js';
import { fetchVersion, isUsablePage } from './discovery.js';

export interface ResolvedConnection {
  wsUrl: string;
  /** browser-level: needs Target.attachToTarget; page-level: evaluate directly. */
  level: 'browser' | 'page';
  source: 'flag' | 'fallback';
}

export interface ResolveOptions {
  /**
   * Skip candidates whose browser has no usable page tabs and keep looking.
   */
  requireUsablePage?: boolean;
}

const FALLBACK_HOST_PORT = '127.0.0.1:9222';

/** Page-level ws URLs contain /devtools/page/<id>; everything else is browser-level. */
export function classifyWsUrl(wsUrl: string): 'browser' | 'page' {
  return wsUrl.includes('/devtools/page/') ? 'page' : 'browser';
}

async function fromHostPort(hostPort: string, source: ResolvedConnection['source']): Promise<ResolvedConnection> {
  const { webSocketDebuggerUrl } = await fetchVersion(hostPort);
  return { wsUrl: webSocketDebuggerUrl, level: classifyWsUrl(webSocketDebuggerUrl), source };
}

async function fromInput(input: string): Promise<ResolvedConnection> {
  if (/^wss?:\/\//i.test(input)) {
    return { wsUrl: input, level: classifyWsUrl(input), source: 'flag' };
  }
  let hostPort: string;
  if (/^https?:\/\//i.test(input)) {
    hostPort = new URL(input).host;
  } else if (/^\d+$/.test(input)) {
    hostPort = `127.0.0.1:${input}`;
  } else {
    hostPort = input;
  }
  return fromHostPort(hostPort, 'flag');
}

/** Does this connection reach a browser with at least one usable page tab? */
async function hasUsablePage(conn: ResolvedConnection): Promise<boolean> {
  if (conn.level === 'page') return true; // already scoped to one page
  let client: CdpClient | undefined;
  try {
    client = await CdpClient.connect(conn.wsUrl, { timeoutMs: 5000 });
    const { targetInfos } = (await client.send('Target.getTargets')) as {
      targetInfos: Array<{ type?: string; url?: string }>;
    };
    return targetInfos.some(isUsablePage);
  } catch {
    return false;
  } finally {
    client?.close();
  }
}

/**
 * Connection resolution:
 *   1. explicit --cdp (ws(s):// direct; http(s):// or host:port or bare port via discovery)
 *   2. fallback probe of 127.0.0.1:9222
 * With requireUsablePage, candidates whose browser has no usable tabs are skipped.
 */
export async function resolveConnection(
  flags: { cdp?: string | boolean },
  opts: ResolveOptions = {},
): Promise<ResolvedConnection> {
  if (flags.cdp && typeof flags.cdp === 'string') {
    const input = flags.cdp;
    try {
      const conn = await fromInput(input);
      if (!opts.requireUsablePage || (await hasUsablePage(conn))) return conn;
      throw new ArtError('no-tabs', `The CDP endpoint ${input} has no usable page tabs.`);
    } catch (e) {
      if (e instanceof ArtError) throw e;
      throw new ArtError('cdp-unreachable', `Cannot reach CDP endpoint ${input}: ${(e as Error).message}`);
    }
  }

  try {
    const conn = await fromHostPort(FALLBACK_HOST_PORT, 'fallback');
    if (!opts.requireUsablePage || (await hasUsablePage(conn))) return conn;
  } catch {
    /* fall through to the error */
  }
  throw new ArtError(
    'no-browser',
    'No browser with an open page found. Start Chrome with --remote-debugging-port=9222, or pass --cdp <port|url>.',
  );
}
