#!/usr/bin/env node
import pino from 'pino';
import * as os from 'os';
import { loadConfig, saveConfig } from './config';
import { BackendClient } from './backend-client';
import { renderEscPos } from './print/render-escpos';
import { sendEscPosOverTcp } from './print/escpos-printer';
import { renderCupsText, sendToCupsQueue } from './print/cups-printer';
import { IdempotencyCache } from './idempotency-cache';
import { startLocalUi } from './web-ui/server';
import { redeemPairingCode } from './pairing';
import type { IncomingJob, PrinterConfig, HeartbeatPrinterStatus } from './types';

const log = pino({ name: 'print-agent' });
const HEARTBEAT_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  const cfg = await loadConfig();
  log.info(`xflow print-agent starting (backend: ${cfg.backendUrl})`);

  const cache = new IdempotencyCache(100);
  const printerStatus: Map<string, HeartbeatPrinterStatus> = new Map();
  const markStatus = (p: PrinterConfig, status: HeartbeatPrinterStatus['status'], err?: string) => {
    printerStatus.set(p.id, {
      id: p.id,
      status,
      lastSuccessAt: status === 'ONLINE' ? new Date().toISOString() : printerStatus.get(p.id)?.lastSuccessAt,
      lastError: err ?? null,
    });
  };

  const onJob = async (job: IncomingJob): Promise<{ status: 'PRINTED' | 'FAILED'; error?: string }> => {
    if (cache.has(job.jobId)) {
      log.warn({ jobId: job.jobId }, 'duplicate job suppressed (already in idempotency cache)');
      return { status: 'PRINTED' };
    }
    const printer = cfg.printers.find((p) => p.id === job.printerId);
    if (!printer) {
      return { status: 'FAILED', error: `unknown printer ${job.printerId}` };
    }
    try {
      if (printer.protocol === 'ESCPOS_TCP' || printer.protocol === 'STAR_LINE_TCP') {
        if (!printer.host || !printer.port) throw new Error('printer has no host/port');
        const dialect = printer.protocol === 'STAR_LINE_TCP' ? 'star-prnt' : 'esc-pos';
        const buf = renderEscPos(job.payload, printer.paperWidth as any, dialect);
        await sendEscPosOverTcp(printer.host, printer.port, buf);
      } else if (printer.protocol === 'CUPS_IPP') {
        if (!printer.cupsQueue) throw new Error('printer has no cups queue');
        const text = renderCupsText(job.payload);
        await sendToCupsQueue(printer.cupsQueue, text);
      } else {
        throw new Error(`unknown protocol ${printer.protocol}`);
      }
      cache.add(job.jobId);
      markStatus(printer, 'ONLINE');
      return { status: 'PRINTED' };
    } catch (err) {
      const msg = (err as Error).message;
      markStatus(printer, 'OFFLINE', msg);
      log.error({ jobId: job.jobId, err: msg }, 'print failed');
      return { status: 'FAILED', error: msg };
    }
  };

  const onPair = async (code: string, displayName: string) => {
    const result = await redeemPairingCode(cfg.backendUrl, {
      code,
      displayName,
      devicePlatform: `${os.platform()}-${os.arch()}`,
      agentVersion: require('../package.json').version,
    });
    cfg.agentId = result.agentId;
    cfg.deviceJwt = result.deviceJwt;
    cfg.hmacSecret = result.hmacSecret;
    cfg.locationId = result.locationId ?? cfg.locationId;
    await saveConfig(cfg);
    log.info(`paired as ${result.agentId}`);
    startClient(); // start backend connection now that we have creds
  };

  let client: BackendClient | null = null;
  const startClient = () => {
    if (!cfg.deviceJwt || !cfg.hmacSecret) return;
    if (client) return;
    client = new BackendClient({
      backendUrl: cfg.backendUrl,
      deviceJwt: cfg.deviceJwt,
      hmacSecret: cfg.hmacSecret,
      onJob,
      logger: {
        info: (m) => log.info(m),
        warn: (m) => log.warn(m),
        error: (m) => log.error(m),
      },
    });
    client.start();
    setInterval(() => {
      const statuses = cfg.printers.map(
        (p) =>
          printerStatus.get(p.id) ?? {
            id: p.id,
            status: 'UNKNOWN' as const,
          },
      );
      client?.sendHeartbeat(statuses, { uiPort: cfg.uiPort, hostname: os.hostname() });
    }, HEARTBEAT_INTERVAL_MS);
  };

  await startLocalUi({
    config: cfg,
    onPair,
    onTestPrint: async (printerId) => {
      const printer = cfg.printers.find((p) => p.id === printerId);
      try {
        await onJob({
          jobId: `local-test-${Date.now()}`,
          printerId,
          payload: [
            { type: 'text', value: printer?.displayName ?? printerId, bold: true, align: 'center', size: 'xl' },
            { type: 'cut' },
          ],
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  });

  // cfg.uiPort may have been re-assigned inside startLocalUi() if the preferred
  // port was already taken — print the port that actually got bound.
  log.info(`local UI on http://localhost:${cfg.uiPort}`);
  startClient();
}

main().catch((err) => {
  console.error(`fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
