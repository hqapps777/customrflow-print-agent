import { createConnection } from 'net';

export interface SendOptions {
  timeoutMs?: number;
  onBytesSent?: () => void;
}

export function sendEscPosOverTcp(
  host: string,
  port: number,
  buffer: Buffer,
  timeoutMsOrOpts: number | SendOptions = 30_000,
): Promise<void> {
  const opts: SendOptions =
    typeof timeoutMsOrOpts === 'number'
      ? { timeoutMs: timeoutMsOrOpts }
      : timeoutMsOrOpts;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const onBytesSent = opts.onBytesSent;
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host, port, timeout: timeoutMs });
    let settled = false;
    let bytesSent = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(err);
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    sock.on('connect', () => {
      sock.write(buffer, (err) => {
        if (err) return fail(err);
        bytesSent = true;
        if (onBytesSent) {
          try {
            onBytesSent();
          } catch {
            /* swallow — informational hook only */
          }
        }
        sock.end();
        ok();
      });
    });
    sock.on('timeout', () => {
      if (bytesSent) return; // post-write timeout: bytes are out, ignore
      fail(new Error(`TCP timeout after ${timeoutMs}ms`));
    });
    sock.on('error', (err) => {
      if (bytesSent) return; // post-write error: bytes are out, ignore
      fail(err);
    });
  });
}
