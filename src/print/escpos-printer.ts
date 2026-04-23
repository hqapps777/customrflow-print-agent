import { createConnection } from 'net';

export function sendEscPosOverTcp(
  host: string,
  port: number,
  buffer: Buffer,
  timeoutMs: number = 8000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host, port, timeout: timeoutMs });
    let settled = false;
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
        sock.end();
      });
    });
    sock.on('end', () => ok());
    sock.on('close', () => ok());
    sock.on('timeout', () => fail(new Error(`TCP timeout after ${timeoutMs}ms`)));
    sock.on('error', (err) => fail(err));
  });
}
