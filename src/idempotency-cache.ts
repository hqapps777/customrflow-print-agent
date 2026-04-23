/**
 * Small FIFO cache of recent job IDs.
 * Prevents duplicate printing when the agent already printed a job but the ack
 * was lost and the backend redelivers. Bounded memory, O(1) membership.
 */
export class IdempotencyCache {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity: number = 100) {}

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(id: string): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.order.push(id);
    while (this.order.length > this.capacity) {
      const drop = this.order.shift();
      if (drop) this.seen.delete(drop);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}
