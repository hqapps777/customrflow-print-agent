import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersistentIdempotencyCache } from './persistent-idempotency-cache';
import { buildOnJob } from './job-handler';
import type { IncomingJob, PrinterConfig } from './types';

async function tmpCachePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jh-'));
  return path.join(dir, 'cache.json');
}

interface Sent {
  protocol: 'tcp' | 'cups';
  host?: string;
  port?: number;
  cupsQueue?: string;
  bufLen?: number;
  textLen?: number;
}

function makeStubs() {
  const sent: Sent[] = [];
  let nextTcpFails: Error | null = null;
  let nextCupsFails: Error | null = null;
  return {
    sent,
    failNextTcp: (err: Error) => {
      nextTcpFails = err;
    },
    failNextCups: (err: Error) => {
      nextCupsFails = err;
    },
    sendTcp: jest.fn(
      async (
        host: string,
        port: number,
        buf: Buffer,
        opts?: { onBytesSent?: () => void },
      ) => {
        if (nextTcpFails) {
          const e = nextTcpFails;
          nextTcpFails = null;
          throw e;
        }
        opts?.onBytesSent?.();
        sent.push({ protocol: 'tcp', host, port, bufLen: buf.length });
      },
    ),
    renderEsc: jest.fn(() => Buffer.from('rendered')),
    sendCups: jest.fn(async (queue: string, text: string) => {
      if (nextCupsFails) {
        const e = nextCupsFails;
        nextCupsFails = null;
        throw e;
      }
      sent.push({ protocol: 'cups', cupsQueue: queue, textLen: text.length });
    }),
    renderCups: jest.fn(() => 'cups-text'),
  };
}

const tcpPrinter: PrinterConfig = {
  id: 'p1',
  displayName: 'Kitchen',
  protocol: 'ESCPOS_TCP' as any,
  host: '10.0.0.42',
  port: 9100,
  paperWidth: 'MM_80' as any,
};

const job: IncomingJob = {
  jobId: 'job-A',
  printerId: 'p1',
  payload: [{ type: 'text', value: 'Hi' } as any],
};

describe('buildOnJob (replay + persistent idempotency)', () => {
  it('prints once for a fresh job and records PRINTED in cache', async () => {
    const cache = await PersistentIdempotencyCache.load(await tmpCachePath());
    const stubs = makeStubs();
    const onJob = buildOnJob({
      cache,
      printers: [tcpPrinter],
      sendEscPosOverTcp: stubs.sendTcp as any,
      renderEscPos: stubs.renderEsc as any,
      sendToCupsQueue: stubs.sendCups as any,
      renderCupsText: stubs.renderCups as any,
      onPrinterStatus: () => {},
    });

    const r = await onJob(job);
    expect(r).toEqual({ status: 'PRINTED' });
    expect(stubs.sent).toHaveLength(1);
    expect(cache.has('job-A')).toBe(true);
  });

  it('does NOT physically print again on replay (same jobId)', async () => {
    const cache = await PersistentIdempotencyCache.load(await tmpCachePath());
    const stubs = makeStubs();
    const onJob = buildOnJob({
      cache,
      printers: [tcpPrinter],
      sendEscPosOverTcp: stubs.sendTcp as any,
      renderEscPos: stubs.renderEsc as any,
      sendToCupsQueue: stubs.sendCups as any,
      renderCupsText: stubs.renderCups as any,
      onPrinterStatus: () => {},
    });

    await onJob(job);
    const r2 = await onJob(job);
    expect(r2).toEqual({ status: 'PRINTED' });
    // First call printed; replay must NOT trigger a second physical send.
    expect(stubs.sent).toHaveLength(1);
  });

  it('records FAILED when the printer rejects, allowing retry', async () => {
    const cache = await PersistentIdempotencyCache.load(await tmpCachePath());
    const stubs = makeStubs();
    stubs.failNextTcp(new Error('ECONNREFUSED'));
    const onJob = buildOnJob({
      cache,
      printers: [tcpPrinter],
      sendEscPosOverTcp: stubs.sendTcp as any,
      renderEscPos: stubs.renderEsc as any,
      sendToCupsQueue: stubs.sendCups as any,
      renderCupsText: stubs.renderCups as any,
      onPrinterStatus: () => {},
    });

    const r = await onJob(job);
    expect(r.status).toBe('FAILED');
    expect(cache.has('job-A')).toBe(false); // FAILED → has() = false → retry allowed
    expect(cache.get('job-A')?.status).toBe('FAILED');

    // Backend retry: this time succeed.
    const r2 = await onJob(job);
    expect(r2.status).toBe('PRINTED');
    expect(stubs.sent).toHaveLength(1);
    expect(cache.has('job-A')).toBe(true);
  });

  it('survives an agent restart (cache reload preserves PRINTED state)', async () => {
    const cachePath = await tmpCachePath();
    const stubs1 = makeStubs();
    const cache1 = await PersistentIdempotencyCache.load(cachePath);
    const onJob1 = buildOnJob({
      cache: cache1,
      printers: [tcpPrinter],
      sendEscPosOverTcp: stubs1.sendTcp as any,
      renderEscPos: stubs1.renderEsc as any,
      sendToCupsQueue: stubs1.sendCups as any,
      renderCupsText: stubs1.renderCups as any,
      onPrinterStatus: () => {},
    });
    await onJob1(job);

    // Simulate restart: fresh cache instance from disk, fresh stubs.
    const stubs2 = makeStubs();
    const cache2 = await PersistentIdempotencyCache.load(cachePath);
    const onJob2 = buildOnJob({
      cache: cache2,
      printers: [tcpPrinter],
      sendEscPosOverTcp: stubs2.sendTcp as any,
      renderEscPos: stubs2.renderEsc as any,
      sendToCupsQueue: stubs2.sendCups as any,
      renderCupsText: stubs2.renderCups as any,
      onPrinterStatus: () => {},
    });
    const r = await onJob2(job);
    expect(r.status).toBe('PRINTED');
    expect(stubs2.sent).toHaveLength(0); // no physical send on the fresh process
  });
});
