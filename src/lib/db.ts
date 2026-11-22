import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

export type Db = pg.Pool;
export type Tx = pg.Pool | pg.PoolClient;
let pool: pg.Pool | undefined;

/** Created on first use, so building without a database works. */
export function getDb(): Db {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
    attachDatabasePool(pool);
  }
  return pool;
}

export async function rows<T>(db: Tx, sql: string, args: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, args)).rows as T[];
}
export async function one<T>(db: Tx, sql: string, args: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, args))[0];
}

/** Runs fn in one transaction: everything in it is saved, or nothing is. */
export async function transaction<T>(db: Db, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let broken: Error | undefined;
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(err => { broken = err; });
    throw e;
  } finally { client.release(broken); }
}
