import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface PairResult {
  agentId: string;
  deviceJwt: string;
  hmacSecret: string;
  locationId?: string;
}

export async function redeemPairingCode(
  backendUrl: string,
  body: { code: string; displayName: string; devicePlatform: string; agentVersion?: string },
): Promise<PairResult> {
  const url = new URL(`${backendUrl}/printing/agent/redeem`);
  const payload = Buffer.from(JSON.stringify(body));
  const options: http.RequestOptions = {
    method: 'POST',
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
    },
  };
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`bad JSON from backend: ${(e as Error).message}`));
          }
        } else {
          reject(new Error(`pairing failed: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
