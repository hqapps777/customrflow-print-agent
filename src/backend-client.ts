import { io, Socket } from 'socket.io-client';
import { createHmac } from 'crypto';
import type { IncomingJob, HeartbeatPrinterStatus } from './types';

export interface BackendClientOptions {
  backendUrl: string;
  deviceJwt: string;
  hmacSecret: string;
  onJob: (job: IncomingJob) => Promise<{ status: 'PRINTED' | 'FAILED'; error?: string }>;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

export class BackendClient {
  private socket: Socket | null = null;
  private readonly log: NonNullable<BackendClientOptions['logger']>;

  constructor(private readonly opts: BackendClientOptions) {
    this.log = opts.logger ?? {
      info: (m) => console.log(m),
      warn: (m) => console.warn(m),
      error: (m) => console.error(m),
    };
  }

  start(): void {
    this.socket = io(`${this.opts.backendUrl}/print-agent`, {
      auth: { token: this.opts.deviceJwt },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 60_000,
      reconnectionAttempts: Infinity,
      transports: ['websocket'],
    });
    this.socket.on('connect', () => {
      this.log.info('backend connected');
      this.opts.onConnect?.();
    });
    this.socket.on('disconnect', (reason) => {
      this.log.warn(`backend disconnected: ${reason}`);
      this.opts.onDisconnect?.(reason);
      // socket.io-client stops auto-reconnecting on 'io server disconnect'
      // (deliberate server kick) and 'io client disconnect' (we called .disconnect()).
      // The dashboard's "Neu verbinden" button uses disconnectSockets(true), which
      // hits the 'io server disconnect' path — without this, the agent would
      // stay dead until the user restarts it by hand. Retry after a grace period
      // so a freshly-rotated JWT / un-revoked agent comes back on its own.
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          try {
            this.socket?.connect();
          } catch {
            // swallow — next interval retry will try again
          }
        }, 5_000);
      }
    });
    this.socket.on('connect_error', (err) => {
      this.log.error(`connect_error: ${err.message}`);
    });
    this.socket.on('job:new', async (payload: IncomingJob, ack?: (r: { ok: boolean }) => void) => {
      try {
        const result = await this.opts.onJob(payload);
        const timestamp = Date.now();
        const hmac = createHmac('sha256', this.opts.hmacSecret)
          .update(`${payload.jobId}|${result.status}|${timestamp}`)
          .digest('hex');
        this.socket?.emit('job:ack', {
          jobId: payload.jobId,
          status: result.status,
          error: result.error,
          timestamp,
          hmac,
        });
        ack?.({ ok: true });
      } catch (err) {
        this.log.error(`onJob crashed: ${(err as Error).message}`);
        ack?.({ ok: false });
      }
    });
  }

  sendHeartbeat(
    printers: HeartbeatPrinterStatus[],
    meta?: { uiPort?: number; hostname?: string },
  ): void {
    this.socket?.emit('heartbeat', { printers, ...(meta ?? {}) });
  }

  stop(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  isConnected(): boolean {
    return !!this.socket?.connected;
  }
}
