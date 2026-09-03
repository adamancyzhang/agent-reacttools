import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PageTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface VersionInfo {
  browser: string;
  webSocketDebuggerUrl: string;
}

const DISCOVERY_TIMEOUT_MS = 2000;

export async function httpGet(url: string, timeoutMs: number = DISCOVERY_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** GET /json/version — browser-level endpoint info. */
export async function fetchVersion(hostPort: string): Promise<VersionInfo> {
  const text = await httpGet(`http://${hostPort}/json/version`);
  const parsed = JSON.parse(text) as { Browser?: string; webSocketDebuggerUrl: string };
  return { browser: parsed.Browser ?? '', webSocketDebuggerUrl: parsed.webSocketDebuggerUrl };
}

/** GET /json/list — per-target (page-level) endpoints. */
export async function listPages(hostPort: string): Promise<PageTarget[]> {
  const text = await httpGet(`http://${hostPort}/json/list`);
  return JSON.parse(text) as PageTarget[];
}

const IGNORED_URL = /^(chrome|devtools|about|edge|chrome-extension):/i;

/** Keep real pages; drop browser-internal targets (new-tab pages, devtools, extensions...). */
export function isUsablePage(target: { type?: string; url?: string }): boolean {
  return target.type === 'page' && !IGNORED_URL.test(target.url ?? '');
}

/**
 * Chrome launched with --remote-debugging-port=0 writes the assigned port and
 * browser ws path into <user-data-dir>/DevToolsActivePort as "<port>\n<wsPath>".
 */
export function readDevToolsActivePort(userDataDir: string): { port: number; wsPath: string } {
  const text = readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8');
  const [port, wsPath] = text.trim().split(/\r?\n/);
  if (!port || !wsPath) throw new Error('Malformed DevToolsActivePort file');
  return { port: Number(port), wsPath };
}
