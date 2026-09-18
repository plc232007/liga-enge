import { AsyncLocalStorage } from 'node:async_hooks';
import type { Client, InValue, Transaction } from '@libsql/client';

// Each async request keeps its own transaction; no mutable global connection state.
export class Database {
  private context = new AsyncLocalStorage<Transaction>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private client: Client) {}

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }

  private async execute(sql: string, args: InValue[]) {
    const tx = this.context.getStore();
    return tx ? tx.execute({ sql, args }) : this.exclusive(() => this.client.execute({ sql, args }));
  }

  prepare(sql: string) {
    return {
      all: async (...args: InValue[]): Promise<unknown[]> => (await this.execute(sql, args)).rows,
      get: async (...args: InValue[]): Promise<Record<string, unknown> | undefined> => (await this.execute(sql, args)).rows[0],
      run: async (...args: InValue[]) => this.execute(sql, args),
    };
  }

  async exec(sql: string): Promise<void> {
    const tx = this.context.getStore();
    if (tx) await tx.executeMultiple(sql);
    else await this.exclusive(() => this.client.executeMultiple(sql));
  }

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.context.getStore()) return fn();
    return this.exclusive(async () => {
      const tx = await this.client.transaction('write');
      try {
        const result = await this.context.run(tx, fn);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally { tx.close(); }
    });
  }

  close() { this.client.close(); }
}
