import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { CdpClient } from '../../src/cdp/client.js';

async function withServer(
  handler: (socket: WebSocket) => void,
): Promise<{ client: CdpClient; close: () => void }> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  server.on('connection', handler);
  const port = (server.address() as AddressInfo).port;
  const client = await CdpClient.connect(`ws://127.0.0.1:${port}`, { timeoutMs: 2000 });
  return {
    client,
    close: () => {
      client.close();
      server.close();
    },
  };
}

function echo(socket: WebSocket): void {
  socket.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as { id: number; method: string; params: unknown; sessionId?: string };
    socket.send(JSON.stringify({ id: msg.id, result: { echoed: msg.method, params: msg.params, sessionId: msg.sessionId } }));
  });
}

describe('CdpClient', () => {
  it('correlates responses by id and forwards sessionId', async () => {
    const { client, close } = await withServer(echo);
    const res = await client.send('Test.method', { a: 1 }, { sessionId: 's1' });
    expect(res).toEqual({ echoed: 'Test.method', params: { a: 1 }, sessionId: 's1' });
    const res2 = await client.send('Test.other');
    expect(res2).toEqual({ echoed: 'Test.other', params: {}, sessionId: undefined });
    close();
  });

  it('rejects on protocol error', async () => {
    const { client, close } = await withServer((socket) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { id: number };
        socket.send(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'boom' } }));
      });
    });
    await expect(client.send('Test.method')).rejects.toThrow(/boom/);
    close();
  });

  it('rejects on timeout', async () => {
    const { client, close } = await withServer(() => {
      /* never respond */
    });
    await expect(client.send('Test.method', {}, { timeoutMs: 50 })).rejects.toThrow(/timed out/);
    close();
  });

  it('rejects pending commands when the socket closes', async () => {
    const { client, close } = await withServer((socket) => {
      socket.on('message', () => socket.close());
    });
    await expect(client.send('Test.method')).rejects.toThrow(/connection closed|connection lost/);
    close();
  });

  it('fails to connect to a refused port', async () => {
    await expect(CdpClient.connect('ws://127.0.0.1:1', { timeoutMs: 1000 })).rejects.toThrow(
      /Cannot connect/,
    );
  });

  it('routes events to handlers', async () => {
    const { client, close } = await withServer((socket) => {
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { id: number };
        socket.send(JSON.stringify({ id: msg.id, result: {} }));
        socket.send(JSON.stringify({ method: 'Page.loadEventFired', params: { ts: 42 } }));
      });
    });
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((msg) => events.push(msg));
    await client.send('Test.method');
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toEqual([{ method: 'Page.loadEventFired', params: { ts: 42 } }]);
    close();
  });
});
