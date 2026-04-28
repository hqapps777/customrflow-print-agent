import { promises as fs } from 'fs';
import * as path from 'path';

export type IdempotencyStatus = 'PRINTED' | 'FAILED';

export interface IdempotencyEntry {
  status: IdempotencyStatus;
  ts: number;
  error?: string;
}

interface FileShape {
  version: 1;
  entries: Record<string, IdempotencyEntry>;
}

const DEFAULT_CAPACITY = 5_000;

/**
 * Disk-backed FIFO cache of recent print jobs. Survives agent restarts so a
 * Backend redispatch (after socket reconnect) cannot trigger a duplicate
 * physical print. JSON file with atomic temp+rename writes — no native deps,
 * works under pkg-bundled standalone binaries on every platform.
 */
export class PersistentIdempotencyCache {
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private readonly capacity: number,
    private entries: Map<string, IdempotencyEntry>,
  ) {}

  static async load(
    filePath: string,
    capacity: number = DEFAULT_CAPACITY,
  ): Promise<PersistentIdempotencyCache> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let parsed: FileShape | null = null;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const obj = JSON.parse(raw);
      if (obj && obj.version === 1 && typeof obj.entries === 'object') {
        parsed = obj as FileShape;
      }
    } catch {
      /* missing or corrupt → start empty */
    }
    const map = new Map<string, IdempotencyEntry>();
    if (parsed) {
      const sorted = Object.entries(parsed.entries).sort(
        (a, b) => a[1].ts - b[1].ts,
      );
      for (const [k, v] of sorted) map.set(k, v);
    }
    return new PersistentIdempotencyCache(filePath, capacity, map);
  }

  get size(): number {
    return this.entries.size;
  }

  /** True when a previous attempt definitively printed and we must NOT reprint. */
  has(jobId: string): boolean {
    return this.entries.get(jobId)?.status === 'PRINTED';
  }

  get(jobId: string): IdempotencyEntry | undefined {
    return this.entries.get(jobId);
  }

  async markPrinted(jobId: string): Promise<void> {
    const existing = this.entries.get(jobId);
    if (existing && existing.status === 'PRINTED') {
      return; // idempotent re-mark, keep original ts
    }
    // New PRINTED OR upgrade from FAILED → use existing ts if present (preserve
    // FIFO insertion order for the upgrade case), else now().
    const ts = existing?.ts ?? Date.now();
    this.entries.delete(jobId);
    this.entries.set(jobId, { status: 'PRINTED', ts });
    this.evictIfNeeded();
    await this.persist();
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    const existing = this.entries.get(jobId);
    if (existing?.status === 'PRINTED') return; // never downgrade
    const ts = existing?.ts ?? Date.now();
    this.entries.delete(jobId);
    this.entries.set(jobId, { status: 'FAILED', ts, error });
    this.evictIfNeeded();
    await this.persist();
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  private persist(): Promise<void> {
    // Serialise writes: concurrent markPrinted/markFailed calls otherwise
    // race on the shared `${filePath}.tmp` (one rename succeeds, the other
    // ENOENTs). The chain ensures one write at a time without dropping any.
    const next = this.writeChain.then(() => this.writeNow());
    this.writeChain = next.catch(() => {
      /* keep the chain alive even if one write failed */
    });
    return next;
  }

  private async writeNow(): Promise<void> {
    const obj: FileShape = {
      version: 1,
      entries: Object.fromEntries(this.entries),
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(obj), 'utf-8');
    await fs.rename(tmp, this.filePath);
  }
}
