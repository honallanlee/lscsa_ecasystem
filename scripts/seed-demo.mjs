// Adds made-up students plus a sample club list and rules. Never adds real people.
// Logins are only created on a local database; a hosted one gets its admin from /setup.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { hashPassword } from '../src/lib/auth.ts';
import { parseImport } from '../src/lib/service.ts';

const FAMILY = ['ALPHA', 'BRAVO', 'CEDAR', 'DELTA', 'EMBER', 'FALCON', 'GROVE', 'HARBOR', 'INDIGO', 'JASPER', 'KESTREL', 'LUNAR'];
const GIVEN = ['Ash', 'Birch', 'Cloud', 'Dune', 'Echo', 'Fern', 'Gale', 'Hazel', 'Iris', 'Juniper'];

export async function seedDemo(url) {
  const local = ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    if ((await c.query('select 1 from students limit 1')).rowCount) { await c.query('rollback'); return false; }
    let fair = (await c.query('select id from fairs where is_current')).rows[0];
    fair ??= (await c.query(`insert into fairs (name, is_current, email_domain) values ('La Salle College ECA Promotion Fair', true, 'example.com') returning id`)).rows[0];
    const read = f => readFileSync(join(import.meta.dirname, '../db/demo', f), 'utf8');
    for (const x of parseImport('clubs', read('clubs.csv'), '').rows) {
      await c.query('insert into clubs values ($1, $2, $3, $4, $5) on conflict do nothing', [fair.id, x.code, x.name, x.category, x.fee]);
    }
    for (const x of parseImport('rules', read('rules.csv'), '').rows) {
      await c.query('insert into rules values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict do nothing', [fair.id, x.level, x.Academic, x.Cultural, x.Interest, x.Service, x.Sports, x.min, x.max]);
    }
    let n = 0;
    for (let form = 1; form <= 6; form++) for (const cls of 'ABCDE') for (let no = 1; no <= 33; no++, n++) {
      const reg = 's' + (90001 + n);
      await c.query('insert into students values ($1, $2, $3, $4, $5, $6, $7, $8)',
        [fair.id, reg, 'S' + form, FAMILY[n % 12] + ' ' + GIVEN[Math.floor(n / 12) % 10], '', form + cls, String(no), reg + '@example.com']);
    }
    if (local) for (const role of ['helper', 'cashier', 'admin']) {
      await c.query('insert into staff (username, name, role, password_hash) values ($1, $2, $3, $4) on conflict do nothing',
        [role, 'Demo ' + role, role, await hashPassword('local-demo-only')]);
    }
    await c.query('commit');
    console.log(`Added ${n} made-up students.` + (local ? ' Local logins: helper, cashier, admin. Password: local-demo-only' : ''));
    return true;
  } finally { await c.end(); }
}

if (process.argv[1] === import.meta.filename) {
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL first.'); process.exit(1); }
  if (!(await seedDemo(process.env.DATABASE_URL))) console.log('There are students already. Nothing was added.');
}
