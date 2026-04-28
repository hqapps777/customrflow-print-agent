import { createServer, Server, Socket } from 'net';
import { sendEscPosOverTcp } from './escpos-printer';

function nextFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close();
        reject(new Error('no port'));
      }
    });
  });
}

interface MockServerHandle {
  port: number;
  close: () => Promise<void>;
  connections: Socket[];
}

async function startMockServer(
  onConnect: (sock: Socket) => void,
): Promise<MockServerHandle> {
  const port = await nextFreePort();
  const connections: Socket[] = [];
  const srv = createServer((sock) => {
    connections.push(sock);
    sock.on('error', () => {
      /* swallow ECONNRESET in tests */
    });
    onConnect(sock);
  });
  await new Promise<void>((resolve) => srv.listen(port, () => resolve()));
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of connections) c.destroy();
        srv.close(() => resolve());
      }),
    connections,
  };
}

describe('sendEscPosOverTcp', () => {
  it('resolves once write-callback fires (does not wait for FIN/close)', async () => {
    let receivedBytes = 0;
    let dataResolve: (() => void) | null = null;
    const dataReceived = new Promise<void>((r) => {
      dataResolve = r;
    });
    const server = await startMockServer((sock) => {
      sock.on('data', (chunk) => {
        receivedBytes += chunk.length;
        dataResolve?.();
      });
      // Intentionally never call sock.end() — simulates a slow printer that
      // accepts bytes but is slow to send FIN. Must not block the resolve.
    });
    try {
      const buf = Buffer.from('hello-print', 'utf8');
      const start = Date.now();
      await sendEscPosOverTcp('127.0.0.1', server.port, buf, 30_000);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2_000);
      await dataReceived;
      expect(receivedBytes).toBe(buf.length);
    } finally {
      await server.close();
    }
  });

  it('does not reject when socket.timeout fires after successful write', async () => {
    const server = await startMockServer((sock) => {
      sock.on('data', () => {
        /* ack receipt but never end */
      });
    });
    try {
      const buf = Buffer.from('payload', 'utf8');
      // 200 ms timeout: hits AFTER write callback, must be ignored.
      await expect(
        sendEscPosOverTcp('127.0.0.1', server.port, buf, 200),
      ).resolves.not.toThrow();
      // Wait long enough for the would-be timeout to fire.
      await new Promise((r) => setTimeout(r, 350));
    } finally {
      await server.close();
    }
  });

  it('rejects when connection is refused', async () => {
    const port = await nextFreePort();
    const buf = Buffer.from('x');
    await expect(sendEscPosOverTcp('127.0.0.1', port, buf, 1_000)).rejects.toThrow();
  });

  it('rejects when timeout fires before write', async () => {
    // Connect to a black-hole address that accepts TCP SYN but never establishes.
    // Use a deliberately unroutable host (TEST-NET-1).
    const buf = Buffer.from('x');
    await expect(
      sendEscPosOverTcp('192.0.2.1', 9100, buf, 250),
    ).rejects.toThrow(/timeout/i);
  });

  it('uses a 30s default timeout', () => {
    // Argument-default sanity. Function prints the value in its timeout-error
    // message, so we infer the default from a connect to a black-hole address
    // is not safe (unrouted hosts may behave differently). Assert via signature.
    const src = sendEscPosOverTcp.toString();
    expect(src).toMatch(/timeoutMs[^,)]*=\s*30[_ ]?000/);
  });

  it('resolves quickly even when the server pauses immediately after data (FIN-lag)', async () => {
    // Reproduces the production bug: thermal printer accepts bytes but is
    // slow to flush FIN. Pre-fix: socket.timeout fires before close and
    // rejects with TCP timeout, even though the printer already printed.
    const server = await startMockServer((sock) => {
      sock.on('data', () => {
        sock.pause(); // halt the read side; will not echo or send FIN
      });
    });
    try {
      const buf = Buffer.from('long-receipt'.repeat(50));
      const start = Date.now();
      // Aggressive 400ms timeout: write callback fires within ms, so resolving
      // on write-callback (not on close) lands well before the timeout.
      await sendEscPosOverTcp('127.0.0.1', server.port, buf, 400);
      expect(Date.now() - start).toBeLessThan(300);
    } finally {
      await server.close();
    }
  });
});
