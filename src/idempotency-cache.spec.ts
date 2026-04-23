import { IdempotencyCache } from './idempotency-cache';

describe('IdempotencyCache', () => {
  it('remembers ids', () => {
    const c = new IdempotencyCache(3);
    c.add('a');
    c.add('b');
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(false);
  });

  it('evicts oldest when capacity exceeded (FIFO)', () => {
    const c = new IdempotencyCache(2);
    c.add('a');
    c.add('b');
    c.add('c');
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(true);
    expect(c.size).toBe(2);
  });

  it('add is idempotent', () => {
    const c = new IdempotencyCache(3);
    c.add('a');
    c.add('a');
    c.add('a');
    expect(c.size).toBe(1);
  });
});
