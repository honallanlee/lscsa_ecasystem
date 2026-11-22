// Local development: starts a private Postgres, adds made-up data, then runs Next.js.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { migrate } from './migrate.mjs';
import { seedDemo } from './seed-demo.mjs';
import './copy-wasm.mjs';

const { startPostgres } = await import('../devtools/postgres.mjs').catch(() => {
  console.error('Run this once first:  npm install --prefix devtools');
  process.exit(1);
});
const db = await startPostgres({ dir: join(import.meta.dirname, '../.data/pg'), port: 54329, persistent: true });
await migrate(db.url);
await seedDemo(db.url);
const port = process.env.PORT || '3000';
const next = spawn(process.execPath, [join(import.meta.dirname, '../node_modules/next/dist/bin/next'), 'dev', '-p', port], {
  stdio: 'inherit', cwd: join(import.meta.dirname, '..'), env: { ...process.env, DATABASE_URL: db.url, SETUP_TOKEN: process.env.SETUP_TOKEN || 'local-setup' }
});
const stop = async () => { next.kill(); await db.stop(); process.exit(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); next.on('exit', stop);
