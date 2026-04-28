import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createServer, Server, Socket } from 'net';
import { PersistentIdempotencyCache } from './persistent-idempotency-cache';
import { buildOnJob } from './job-handler';
import { sendEscPosOverTcp } from './print/escpos-printer';
import type { IncomingJob, PrinterConfig } from './types';

interface MockServer {
  port: number;
  receivedJobs: number;
  close: () => Promise<void>;
}

async function startSlowFinPrinter(): Promise<MockServer> {
  const sockets: Socket[] = [];
  let receivedJobs = 0;
  const srv: Server = createServer((sock) => {
    sockets.push(sock);
    sock.on('error', () => {});
    sock.on('data', () => {
      receivedJobs += 1;
      // Simulate a real thermal printer: accept bytes but never close FIN.
      // Without Task 1's "resolve on write-callback", this would trigger
      // socket.timeout on the client and produce false-FAILED acks → retries.
      sock.pause();
    });
  });
  const port: number = await new Promise((resolve) => {
    srv.listen(0, () => {
      const a = srv.address();
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });
  return {
    port,
    get receivedJobs() {
      return receivedJobs;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        srv.close(() => resolve());
      }),
  } as MockServer;
}

async function tmpCachePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'int-'));
  return path.join(dir, 'cache.json');
}

const printer: PrinterConfig = {
  id: 'kit-1',
  displayName: 'Kitchen',
  protocol: 'ESCPOS_TCP' as any,
  host: '127.0.0.1',
  port: 0, // filled per-test
  paperWidth: 'MM_80' as any,
};

const job: IncomingJob = {
  jobId: 'order-99',
  printerId: 'kit-1',
  payload: [{ type: 'text', value: 'Hello' } as any],
};

describe('integration: backend retry storm produces exactly 1 physical print', () => {
  it('FIN-lag thermal printer + 3 backend redispatches → 1 physical print', async () => {
    const srv = await startSlowFinPrinter();
    const cachePath = await tmpCachePath();
    const cache = await PersistentIdempotencyCache.load(cachePath);

    const onJob = buildOnJob({
      cache,
      printers: [{ ...printer, port: srv.port }],
      sendEscPosOverTcp,
      // minimal renderer: emit a fixed buffer.
      renderEscPos: () => Buffer.from('ESCPOS-PAYLOAD'),
      sendToCupsQueue: async () => {
        throw new Error('not used');
      },
      renderCupsText: () => '',
      onPrinterStatus: () => {},
    });

    try {
      // Backend dispatch #1
      const ack1 = await onJob(job);
      expect(ack1.status).toBe('PRINTED');
      // Backend retry storm — same jobId arrives twice more.
      const ack2 = await onJob(job);
      const ack3 = await onJob(job);
      expect(ack2.status).toBe('PRINTED');
      expect(ack3.status).toBe('PRINTED');

      // Allow the server's data event to fire for the first send.
      await new Promise((r) => setTimeout(r, 50));
      expect(srv.receivedJobs).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it('agent restart after print: cache reload prevents second physical print', async () => {
    const srv = await startSlowFinPrinter();
    const cachePath = await tmpCachePath();

    const cache1 = await PersistentIdempotencyCache.load(cachePath);
    const onJob1 = buildOnJob({
      cache: cache1,
      printers: [{ ...printer, port: srv.port }],
      sendEscPosOverTcp,
      renderEscPos: () => Buffer.from('PAY'),
      sendToCupsQueue: async () => {
        throw new Error('na');
      },
      renderCupsText: () => '',
      onPrinterStatus: () => {},
    });

    try {
      await onJob1(job);
      await new Promise((r) => setTimeout(r, 50));

      // Simulate agent restart with a fresh cache instance reading from disk.
      const cache2 = await PersistentIdempotencyCache.load(cachePath);
      const onJob2 = buildOnJob({
        cache: cache2,
        printers: [{ ...printer, port: srv.port }],
        sendEscPosOverTcp,
        renderEscPos: () => Buffer.from('PAY'),
        sendToCupsQueue: async () => {
          throw new Error('na');
        },
        renderCupsText: () => '',
        onPrinterStatus: () => {},
      });

      const ack = await onJob2(job);
      expect(ack.status).toBe('PRINTED');
      await new Promise((r) => setTimeout(r, 50));
      expect(srv.receivedJobs).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it('connection refused: 2 retries fail → cache marked FAILED, allows manual reprint later', async () => {
    // Pick an unused port — never start a server on it.
    const probe = await startSlowFinPrinter();
    const port = probe.port;
    await probe.close();

    const cachePath = await tmpCachePath();
    const cache = await PersistentIdempotencyCache.load(cachePath);

    const onJob = buildOnJob({
      cache,
      printers: [{ ...printer, port }],
      sendEscPosOverTcp,
      renderEscPos: () => Buffer.from('X'),
      sendToCupsQueue: async () => {
        throw new Error('na');
      },
      renderCupsText: () => '',
      onPrinterStatus: () => {},
    });

    const a1 = await onJob(job);
    const a2 = await onJob(job);
    expect(a1.status).toBe('FAILED');
    expect(a2.status).toBe('FAILED');
    expect(cache.has(job.jobId)).toBe(false); // FAILED → may retry
    expect(cache.get(job.jobId)?.status).toBe('FAILED');
  });
});
