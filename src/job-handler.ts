import type { IncomingJob, PrinterConfig, HeartbeatPrinterStatus } from './types';
import type { PersistentIdempotencyCache } from './persistent-idempotency-cache';

export type JobAck = { status: 'PRINTED' | 'FAILED'; error?: string };

export interface JobHandlerDeps {
  cache: PersistentIdempotencyCache;
  printers: PrinterConfig[];
  sendEscPosOverTcp: (
    host: string,
    port: number,
    buf: Buffer,
    opts?: { timeoutMs?: number; onBytesSent?: () => void },
  ) => Promise<void>;
  renderEscPos: (
    payload: any,
    paperWidth: any,
    dialect: 'esc-pos' | 'star-prnt',
  ) => Buffer;
  sendToCupsQueue: (queue: string, text: string) => Promise<void>;
  renderCupsText: (payload: any) => string;
  onPrinterStatus: (
    printer: PrinterConfig,
    status: HeartbeatPrinterStatus['status'],
    err?: string,
  ) => void;
  log?: { warn: (m: string) => void; error: (m: string) => void };
}

function resolvePrinter(
  printers: PrinterConfig[],
  job: IncomingJob,
): PrinterConfig | null {
  const local = printers.find((p) => p.id === job.printerId);
  if (local) return local;
  // Backend may push a printer the agent has no local mirror for; payload
  // carries connection details directly in that case.
  const j: any = job;
  if (j.host || j.cupsQueue) {
    return {
      id: job.printerId,
      displayName: j.printerId,
      protocol: (j.protocol ?? 'ESCPOS_TCP') as any,
      host: j.host,
      port: j.port ?? 9100,
      cupsQueue: j.cupsQueue,
      paperWidth: (j.paperWidth ?? 'MM_80') as any,
    };
  }
  return null;
}

export function buildOnJob(deps: JobHandlerDeps) {
  return async function onJob(job: IncomingJob): Promise<JobAck> {
    // Replay path: a previous attempt definitively printed this jobId. The
    // backend (BullMQ retry, reconnect storm, restarted dispatcher) may
    // resend — never re-emit physical bytes for a known PRINTED job.
    if (deps.cache.has(job.jobId)) {
      deps.log?.warn(
        `duplicate job suppressed (jobId=${job.jobId} already PRINTED in cache)`,
      );
      return { status: 'PRINTED' };
    }

    const printer = resolvePrinter(deps.printers, job);
    if (!printer) {
      return {
        status: 'FAILED',
        error: `unknown printer ${job.printerId} and no payload data`,
      };
    }

    try {
      if (
        printer.protocol === 'ESCPOS_TCP' ||
        printer.protocol === 'STAR_LINE_TCP'
      ) {
        if (!printer.host || !printer.port) {
          throw new Error('printer has no host/port');
        }
        const dialect =
          printer.protocol === 'STAR_LINE_TCP' ? 'star-prnt' : 'esc-pos';
        const buf = deps.renderEscPos(job.payload, printer.paperWidth, dialect);
        // Task 1 (xflow-wsct) guarantees: this resolves iff the write callback
        // fired without error, i.e. bytes are committed to the socket. Post-
        // write timeouts/RSTs are suppressed inside sendEscPosOverTcp.
        await deps.sendEscPosOverTcp(printer.host, printer.port, buf);
      } else if (printer.protocol === 'CUPS_IPP') {
        if (!printer.cupsQueue) throw new Error('printer has no cups queue');
        const text = deps.renderCupsText(job.payload);
        await deps.sendToCupsQueue(printer.cupsQueue, text);
      } else {
        throw new Error(`unknown protocol ${printer.protocol}`);
      }
      await deps.cache.markPrinted(job.jobId);
      deps.onPrinterStatus(printer, 'ONLINE');
      return { status: 'PRINTED' };
    } catch (err) {
      const msg = (err as Error).message;
      deps.onPrinterStatus(printer, 'OFFLINE', msg);
      deps.log?.error(`print failed jobId=${job.jobId} err=${msg}`);
      // Do not overwrite a PRINTED entry that onBytesSent already wrote.
      // markFailed checks status='PRINTED' and is a no-op in that case.
      await deps.cache.markFailed(job.jobId, msg);
      return { status: 'FAILED', error: msg };
    }
  };
}
