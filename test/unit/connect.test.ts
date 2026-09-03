import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConnection } from '../../src/cdp/connect.js';

// --- controllable mocks -----------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// The CdpClient used by hasUsablePage: each Target.getTargets call pops the
// next tab snapshot from mockTargets (a queue).
const { mockTargets } = vi.hoisted(() => ({
  mockTargets: { value: [] as Array<Array<{ type?: string; url?: string }>> },
}));

vi.mock('../../src/cdp/client.js', () => ({
  CdpClient: class {
    static connect() {
      // `this` is the class itself in a static method.
      return Promise.resolve(new (this as unknown as new () => unknown)());
    }
    send(method: string) {
      if (method === 'Target.getTargets') {
        return Promise.resolve({ targetInfos: mockTargets.value.shift() ?? [] });
      }
      return Promise.resolve({});
    }
    close() {}
  },
}));

function versionResponse(wsUrl: string): Response {
  return new Response(JSON.stringify({ Browser: 'Chrome/130', webSocketDebuggerUrl: wsUrl }), { status: 200 });
}

beforeEach(() => {
  fetchMock.mockReset();
  mockTargets.value = [];
});

describe('resolveConnection', () => {
  it('passes ws:// URLs straight through (browser level)', async () => {
    const conn = await resolveConnection({ cdp: 'ws://127.0.0.1:9222/devtools/browser/abc' });
    expect(conn).toEqual({ wsUrl: 'ws://127.0.0.1:9222/devtools/browser/abc', level: 'browser', source: 'flag' });
  });

  it('classifies page-level ws URLs', async () => {
    const conn = await resolveConnection({ cdp: 'ws://127.0.0.1:9222/devtools/page/xyz' });
    expect(conn.level).toBe('page');
  });

  it('resolves bare ports via discovery', async () => {
    fetchMock.mockResolvedValue(versionResponse('ws://127.0.0.1:9222/devtools/browser/1'));
    const conn = await resolveConnection({ cdp: '9222' });
    expect(conn).toEqual({ wsUrl: 'ws://127.0.0.1:9222/devtools/browser/1', level: 'browser', source: 'flag' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9222/json/version', expect.anything());
  });

  it('resolves host:port and http(s) URLs via discovery', async () => {
    fetchMock.mockResolvedValue(versionResponse('ws://localhost:9229/devtools/browser/2'));
    const conn = await resolveConnection({ cdp: 'localhost:9229' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:9229/json/version', expect.anything());
    expect(conn.wsUrl).toBe('ws://localhost:9229/devtools/browser/2');

    fetchMock.mockResolvedValue(versionResponse('ws://localhost:9229/devtools/browser/3'));
    const conn2 = await resolveConnection({ cdp: 'http://localhost:9229/extra/path' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:9229/json/version', expect.anything());
    expect(conn2.source).toBe('flag');
  });

  it('probes 127.0.0.1:9222 when no --cdp is given', async () => {
    fetchMock.mockResolvedValue(versionResponse('ws://127.0.0.1:9222/devtools/browser/fb'));
    const conn = await resolveConnection({});
    expect(conn).toEqual({ wsUrl: 'ws://127.0.0.1:9222/devtools/browser/fb', level: 'browser', source: 'fallback' });
  });

  it('fails with a helpful error when nothing is found', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(resolveConnection({})).rejects.toThrow(/No browser/);
  });
});

describe('resolveConnection with requireUsablePage', () => {
  const usablePage = { type: 'page', url: 'http://127.0.0.1:4173/' };

  it('uses the 9222 fallback when its browser has usable tabs', async () => {
    fetchMock.mockResolvedValue(versionResponse('ws://127.0.0.1:9222/devtools/browser/fb'));
    mockTargets.value = [[usablePage]];
    const conn = await resolveConnection({}, { requireUsablePage: true });
    expect(conn).toEqual({ wsUrl: 'ws://127.0.0.1:9222/devtools/browser/fb', level: 'browser', source: 'fallback' });
  });

  it('fails when the fallback browser has no usable tabs', async () => {
    fetchMock.mockResolvedValue(versionResponse('ws://127.0.0.1:9222/devtools/browser/fb'));
    mockTargets.value = [[]];
    await expect(resolveConnection({}, { requireUsablePage: true })).rejects.toThrow(/No browser/);
  });

  it('rejects an explicit --cdp endpoint without usable tabs', async () => {
    mockTargets.value = [[]];
    await expect(
      resolveConnection({ cdp: 'ws://127.0.0.1:9222/devtools/browser/x' }, { requireUsablePage: true }),
    ).rejects.toThrow(/no usable page tabs/);
  });

  it('wraps unreachable explicit endpoints in a clear error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(resolveConnection({ cdp: '9999' })).rejects.toThrow(/Cannot reach CDP endpoint 9999/);
  });
});
