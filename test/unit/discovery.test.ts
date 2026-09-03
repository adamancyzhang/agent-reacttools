import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchVersion, httpGet, isUsablePage, listPages, readDevToolsActivePort } from '../../src/cdp/discovery.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('httpGet', () => {
  it('returns body text', async () => {
    fetchMock.mockResolvedValue(new Response('hello', { status: 200 }));
    await expect(httpGet('http://x/')).resolves.toBe('hello');
  });

  it('throws on non-200', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(httpGet('http://x/')).rejects.toThrow(/HTTP 500/);
  });

  it('aborts after timeout', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
    );
    await expect(httpGet('http://x/', 20)).rejects.toThrow(/Aborted/);
  });
});

describe('fetchVersion / listPages', () => {
  it('parses /json/version', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ Browser: 'Chrome/130', webSocketDebuggerUrl: 'ws://x/browser/1' }), {
        status: 200,
      }),
    );
    await expect(fetchVersion('127.0.0.1:9222')).resolves.toEqual({
      browser: 'Chrome/130',
      webSocketDebuggerUrl: 'ws://x/browser/1',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9222/json/version', expect.anything());
  });

  it('parses /json/list', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: '1', type: 'page', title: 'a', url: 'http://a', webSocketDebuggerUrl: 'ws://x/page/1' }]), {
        status: 200,
      }),
    );
    const pages = await listPages('127.0.0.1:9222');
    expect(pages[0]!.webSocketDebuggerUrl).toBe('ws://x/page/1');
  });
});

describe('isUsablePage', () => {
  it('keeps normal pages and drops internals', () => {
    expect(isUsablePage({ type: 'page', url: 'https://example.com/' })).toBe(true);
    expect(isUsablePage({ type: 'page', url: 'http://127.0.0.1:4173/' })).toBe(true);
    expect(isUsablePage({ type: 'page', url: 'chrome://newtab/' })).toBe(false);
    expect(isUsablePage({ type: 'page', url: 'devtools://devtools/bundled/' })).toBe(false);
    expect(isUsablePage({ type: 'page', url: 'about:blank' })).toBe(false);
    expect(isUsablePage({ type: 'other', url: 'https://example.com/' })).toBe(false);
  });
});

describe('readDevToolsActivePort', () => {
  it('parses "<port>\\n<wsPath>"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-'));
    try {
      writeFileSync(join(dir, 'DevToolsActivePort'), '54321\n/devtools/browser/abc-123');
      expect(readDevToolsActivePort(dir)).toEqual({ port: 54321, wsPath: '/devtools/browser/abc-123' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects malformed content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-'));
    try {
      writeFileSync(join(dir, 'DevToolsActivePort'), '54321');
      expect(() => readDevToolsActivePort(dir)).toThrow(/Malformed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
