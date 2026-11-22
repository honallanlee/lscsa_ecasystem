import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

/** Starts a throwaway or persistent local Postgres and returns its URL and a stop function. */
export async function startPostgres({ dir, port, persistent }) {
  const server = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'local-only', persistent, onLog() {}, onError() {} });
  if (!existsSync(dir + '/PG_VERSION')) await server.initialise();
  await server.start();
  try { await server.createDatabase('eca'); } catch { /* already there */ }
  return { url: `postgres://postgres:local-only@localhost:${port}/eca`, stop: () => server.stop() };
}
