// Applies db/migrations/*.sql in order, once each. Safe to run repeatedly and at the same time.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export async function migrate(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(7240031)');
    await client.query('create table if not exists schema_migrations (name text primary key, at timestamptz not null default now())');
    const done = new Set((await client.query('select name from schema_migrations')).rows.map(r => r.name));
    const dir = join(import.meta.dirname, '../db/migrations');
    for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      await client.query('begin');
      try {
        await client.query(readFileSync(join(dir, name), 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [name]);
        await client.query('commit');
        console.log('Applied ' + name);
      } catch (e) { await client.query('rollback'); throw e; }
    }
  } finally { await client.end(); }
}

if (process.argv[1] === import.meta.filename) {
  // Migrations need a direct connection: Neon's pooled one does not keep session locks.
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const building = process.argv.includes('--build');
  if (building && process.env.VERCEL && process.env.VERCEL_ENV !== 'production') console.log('Preview build: migrations skipped.');
  else if (building && !url) console.log('No DATABASE_URL yet: migrations skipped.');
  else if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
  else await migrate(url);
}
