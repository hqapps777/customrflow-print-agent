import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersistentIdempotencyCache } from './persistent-idempotency-cache';

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pcache-'));
  return path.join(dir, 'idempotency.json');
}

describe('PersistentIdempotencyCache', () => {
  it('starts empty when file does not exist', async () => {
    const f = await tmpFile();
    const c = await PersistentIdempotencyCache.load(f);
    expect(c.size).toBe(0);
    expect(c.has('any')).toBe(false);
  });

  it('records PRINTED entries and persists across reloads', async () => {
    const f = await tmpFile();
    const c1 = await PersistentIdempotencyCache.load(f);
    await c1.markPrinted('job-1');
    expect(c1.has('job-1')).toBe(true);
    expect(c1.get('job-1')?.status).toBe('PRINTED');

    const c2 = await PersistentIdempotencyCache.load(f);
    expect(c2.has('job-1')).toBe(true);
    expect(c2.get('job-1')?.status).toBe('PRINTED');
  });

  it('records FAILED entries but has() returns false (failed jobs may retry)', async () => {
    const f = await tmpFile();
    const c = await PersistentIdempotencyCache.load(f);
    await c.markFailed('job-2', 'paper out');
    // has() means "do not print again" → FAILED is allowed to retry
    expect(c.has('job-2')).toBe(false);
    expect(c.get('job-2')?.status).toBe('FAILED');
    expect(c.get('job-2')?.error).toBe('paper out');
  });

  it('upgrades a FAILED entry to PRINTED on later success', async () => {
    const f = await tmpFile();
    const c = await PersistentIdempotencyCache.load(f);
    await c.markFailed('job-3', 'transient');
    await c.markPrinted('job-3');
    expect(c.has('job-3')).toBe(true);
    expect(c.get('job-3')?.status).toBe('PRINTED');
    expect(c.get('job-3')?.error).toBeUndefined();
  });

  it('evicts oldest entries when capacity exceeded (FIFO by ts)', async () => {
    const f = await tmpFile();
    const c = await PersistentIdempotencyCache.load(f, 3);
    await c.markPrinted('a');
    await c.markPrinted('b');
    await c.markPrinted('c');
    await c.markPrinted('d');
    expect(c.size).toBe(3);
    expect(c.has('a')).toBe(false);
    expect(c.has('d')).toBe(true);
  });

  it('survives a corrupt cache file (treats as empty, does not crash)', async () => {
    const f = await tmpFile();
    await fs.writeFile(f, '{not-json', 'utf-8');
    const c = await PersistentIdempotencyCache.load(f);
    expect(c.size).toBe(0);
    await c.markPrinted('job-x');
    expect(c.has('job-x')).toBe(true);
  });

  it('writes atomically (no .tmp file left behind on success)', async () => {
    const f = await tmpFile();
    const c = await PersistentIdempotencyCache.load(f);
    await c.markPrinted('job-1');
    const dir = path.dirname(f);
    const entries = await fs.readdir(dir);
    expect(entries).toContain(path.basename(f));
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });

  it('markPrinted is idempotent (calling twice is a no-op for status)', async () => {
    const f = await tmpFile();
    const c = await PersistentIdempotencyCache.load(f);
    await c.markPrinted('job-1');
    const ts1 = c.get('job-1')!.ts;
    await new Promise((r) => setTimeout(r, 5));
    await c.markPrinted('job-1');
    const ts2 = c.get('job-1')!.ts;
    expect(c.size).toBe(1);
    expect(c.get('job-1')?.status).toBe('PRINTED');
    // Re-marking PRINTED keeps original ts to preserve insertion order.
    expect(ts2).toBe(ts1);
  });
});
