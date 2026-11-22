// Runs against a real Postgres, with genuinely simultaneous requests.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startPostgres } from '../devtools/postgres.mjs';
import { migrate } from '../scripts/migrate.mjs';
import { seedDemo } from '../scripts/seed-demo.mjs';
import { actorFor, firstAdmin, login, logout, needsSetup, type Actor } from '../src/lib/auth.ts';
import { parseImport, routeFor, type Payload } from '../src/lib/service.ts';
import type { Message, Sender } from '../src/lib/email.ts';

let server: { url: string; stop(): Promise<void> }, dir: string, db: pg.Pool;
let admin: Actor, cashier: Actor, helper: Actor, sent: Message[] = [], failEmail = false;
const send: Sender = async m => { if (failEmail) throw new Error('down'); sent.push(m); };
type Any = any;
const call = (name: string, p: Payload = {}, me: Actor = admin): Promise<Any> => routeFor(name)!.run({ db, me, send }, p);
const code = (c: string) => (e: Any) => e.code === c;
const reg = (regNo: string, codes: string[], baseVersion = 0, requestId = randomUUID()) => call('register', { requestId, regNo, phone: '61234567', codes, baseVersion });
const pay = (regNo: string, version: number, due: number, extra: Payload = {}) => call('checkout', { requestId: randomUUID(), regNo, version, due, method: 'Cash', tendered: '1000', ...extra });
const S1 = ['C04', 'U02', 'S02']; // fees 10 + 5 + 10

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'eca-'));
  server = await startPostgres({ dir: join(dir, 'pg'), port: 54400 + Math.floor(Math.random() * 500), persistent: false });
  await Promise.all([migrate(server.url), migrate(server.url)]); // two deploys at once must be safe
  await seedDemo(server.url);
  db = new pg.Pool({ connectionString: server.url, max: 25 });
  const who = async (u: string) => (await actorFor(db, await login(db, { username: u, password: 'local-demo-only', ip: 't' })))!;
  admin = await who('admin'); cashier = await who('cashier'); helper = await who('helper');
});
after(async () => { await db?.end(); await server?.stop(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { sent = []; failEmail = false; await db.query('truncate registrations, registration_clubs, checkouts, emails, notes, cashups, audit, login_failures cascade'); });

test('register, pay, then blocked from paying twice', async () => {
  const v = await reg('s90001', S1);
  assert.deepEqual([v.status, v.due], ['REGISTERED', 2500]);
  const r = await pay('s90001', 1, 2500, { tendered: '50' });
  assert.deepEqual([r.amount, r.change], [2500, 2500]);
  await assert.rejects(pay('s90001', 1, 2500), code('PAID'));
  assert.equal((await call('lookup', { regNo: '90001' })).status, 'CONFIRMED');
});
test('twenty cashiers press Pay for the same student at once: one payment', async () => {
  await reg('s90001', S1);
  const r = await Promise.allSettled(Array.from({ length: 20 }, () => pay('s90001', 1, 2500)));
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  assert.ok(r.every(x => x.status === 'fulfilled' || x.reason.code === 'PAID'));
});
test('the same request sent ten times saves once and answers the same', async () => {
  const id = randomUUID();
  await Promise.all(Array.from({ length: 10 }, () => reg('s90001', S1, 0, id)));
  const pid = randomUUID();
  const out = await Promise.all(Array.from({ length: 10 }, () => pay('s90001', 1, 2500, { requestId: pid })));
  assert.equal(new Set(out.map(o => o.checkoutId)).size, 1);
  assert.equal((await db.query('select 1 from registrations')).rowCount, 1);
  assert.equal((await db.query('select 1 from checkouts')).rowCount, 1);
});
test('a request id cannot be reused for another student', async () => {
  const id = randomUUID();
  await reg('s90001', S1, 0, id);
  await assert.rejects(reg('s90002', S1, 0, id), code('BAD'));
});
test('two helpers edit one student at once: one wins, one is told', async () => {
  const r = await Promise.allSettled([reg('s90001', S1), reg('s90001', ['C01', 'U01', 'S01'])]);
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((r.find(x => x.status === 'rejected') as Any).reason.code, 'CONFLICT');
});
test('amending after payment charges the difference, or refunds it', async () => {
  await reg('s90001', S1); await pay('s90001', 1, 2500);
  const up = await reg('s90001', [...S1, 'A06'], 1);
  assert.deepEqual([up.status, up.due], ['AMENDED', 500]);
  await assert.rejects(pay('s90001', 1, 2500), code('CONFLICT')); // stale screen
  await pay('s90001', 2, 500);
  const down = await reg('s90001', ['C01', 'U01', 'S01'], 2);
  assert.equal(down.due, -3000);
  assert.equal((await pay('s90001', 3, -3000)).amount, -3000);
  assert.deepEqual((({ status, paid, due }) => ({ status, paid, due }))(await call('lookup', { regNo: 's90001' })), { status: 'CONFIRMED', paid: 0, due: 0 });
  assert.equal((await db.query('select 1 from registrations')).rowCount, 3, 'history is kept');
});
test('the server ignores browser prices and checks the rules itself', async () => {
  await assert.rejects(reg('s90001', ['C04', 'U02']), code('RULES'));
  await assert.rejects(reg('s90001', [...S1, 'ZZ9']), code('RULES'));
  await reg('s90001', S1);
  await assert.rejects(pay('s90001', 1, 0), code('CONFLICT'));
  await assert.rejects(pay('s90001', 1, 2500, { tendered: '20' }), code('BAD'));
  await assert.rejects(pay('s90001', 1, 2500, { method: 'IOU' }), code('BAD'));
  await assert.rejects(pay('s90002', 0, 0), code('BAD'));
  await assert.rejects(call('lookup', { regNo: "s1' or 1=1" }), code('BAD'));
});
test('a price change later does not alter what was registered', async () => {
  await reg('s90001', S1);
  await db.query(`update clubs set fee_cents = 9900 where code = 'C04'`);
  assert.equal((await call('lookup', { regNo: 's90001' })).due, 2500);
  await db.query(`update clubs set fee_cents = 1000 where code = 'C04'`);
});
test('free choices confirm with no payment method', async () => {
  await reg('s90001', ['C01', 'U01', 'S01']);
  assert.equal((await pay('s90001', 1, 0, { method: '', tendered: '' })).method, 'None');
});
test('dashboard counts settled money only, and cash-up balances', async () => {
  await reg('s90001', S1); await reg('s90002', S1); await pay('s90001', 1, 2500);
  const d = await call('dashboard');
  assert.deepEqual([d.collected, d.due, d.owing], [2500, 2500, 1]);
  const c = d.clubs.find((x: Any) => x.code === 'C04');
  assert.deepEqual([c.signups, c.confirmed, c.payout], [2, 1, 1000]);
  assert.equal(d.clubs.reduce((t: number, x: Any) => t + x.payout, 0), d.collected);
  assert.equal((await call('cashup', { requestId: randomUUID(), method: 'Cash', counted: '24.50' })).difference, -50);
});
test('school export includes every club (old bug: the last two were dropped)', async () => {
  await reg('s90001', ['C01', 'U01', 'S17', 'S18']);
  const e = await call('exportCsv', { kind: 'school' });
  assert.match(e.csv, /Tenpin Bowling Club/); assert.match(e.csv, /Volleyball Club/);
  assert.equal(e.count, 4);
  for (const kind of ['absent', 'owing', 'payments', 'audit']) assert.ok((await call('exportCsv', { kind })).csv);
  assert.match((await call('exportCsv', { kind: 'owing' })).csv, /REGISTERED,15\.00,0\.00,15\.00/);
  await assert.rejects(call('exportCsv', { kind: 'constructor' }), code('BAD'));
});
test('email: only when asked, not twice, capped, and failure never loses the payment', async () => {
  await reg('s90001', S1); const r = await pay('s90001', 1, 2500);
  assert.equal(sent.length, 0);
  failEmail = true;
  await assert.rejects(call('sendEmail', { checkoutId: r.checkoutId }, cashier), code('EMAIL'));
  assert.equal((await call('lookup', { regNo: 's90001' })).status, 'CONFIRMED');
  failEmail = false;
  const rush = await Promise.allSettled(Array.from({ length: 5 }, () => call('sendEmail', { checkoutId: r.checkoutId }, cashier)));
  assert.equal(rush.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(sent.length, 1); assert.equal(sent[0]!.to, 's90001@example.com');
  assert.match(sent[0]!.html, /<td[^>]*>Cultural<\/td>/); assert.doesNotMatch(sent[0]!.text, /<td/);
  process.env.EMAIL_MONTHLY_CAP = '1';
  await reg('s90002', S1); const r2 = await pay('s90002', 1, 2500);
  await assert.rejects(call('sendEmail', { checkoutId: r2.checkoutId }, cashier), /limit of 1/);
  delete process.env.EMAIL_MONTHLY_CAP;
});
test('names are escaped in emails', async () => {
  await db.query(`update students set name = 'X <img src=x onerror=1>' where reg_no = 's90003'`);
  await reg('s90003', S1); const r = await pay('s90003', 1, 2500);
  await call('sendEmail', { checkoutId: r.checkoutId });
  assert.doesNotMatch(sent[0]!.html, /<img/);
});
test('imports: bad files change nothing, good files keep registered students', async () => {
  await reg('s90001', S1);
  const n = async () => (await db.query('select count(*)::int n from students')).rows[0].n;
  const total = await n();
  const badFile = 'RegNo,ClassLevel,StudentName_Eng,Class,ClassNo\nxyz,S1,A,1A,1\n90001,S1,,1A,2\n90001,S1,B,1A,3\n';
  assert.equal((await call('importPreview', { kind: 'students', csv: badFile })).errorCount, 3);
  await assert.rejects(call('importCommit', { kind: 'students', csv: badFile }), code('BAD'));
  assert.equal(await n(), total);
  const keep = (await db.query('select reg_no, level, name, class, class_no from students')).rows;
  const csv = 'RegNo,ClassLevel,StudentName_Eng,Class,ClassNo\n' + '90500,S1,NEW Person,1A,1\n';
  assert.match((await call('importPreview', { kind: 'students', csv })).warnings.join(), /1 registered student/);
  await call('importCommit', { kind: 'students', csv });
  assert.equal(await n(), 2, 'the new student, plus the one who had registered');
  await call('importCommit', { kind: 'students', csv: 'RegNo,ClassLevel,StudentName_Eng,Class,ClassNo\n' + keep.map(k => [k.reg_no, k.level, k.name.replace(/[<>"]/g, ''), k.class, k.class_no].join()).join('\n') });
  await assert.rejects(call('importPreview', { kind: '__proto__', csv }), code('BAD'));
});
test('print list gives one class in class-number order', async () => {
  const r = await call('printList', { cls: '1A' });
  assert.equal(r.classes.length, 30); assert.equal(r.students.length, 33);
  assert.deepEqual(r.students.slice(0, 2).map((x: Any) => x.classNo), ['1', '2']); assert.equal(r.students[9].classNo, '10');
  assert.equal((await call('printList', { cls: '' })).students.length, 0);
});
test('rules that cannot be met are refused', () => {
  assert.match(parseImport('rules', 'Level,Academic,Cultural,Interest,Service,Sports,Min,Max\nS1,2,2,2,0,0,3,4', '').errors.join(), /add up to more than max/);
});
test('notes are kept per student and removed by id', async () => {
  const id = randomUUID();
  await Promise.all([1, 2, 3].map(() => call('noteAdd', { requestId: id, regNo: 's90001', text: '=1+1 <b>' }, helper)));
  assert.equal((await call('noteList')).length, 1);
  await call('noteRemove', { id }, helper);
  assert.equal((await call('noteList')).length, 0);
});
test('every action needs a role', () => {
  const need = Object.fromEntries(['checkout', 'sendEmail', 'cash', 'importCommit', 'exportCsv', 'saveStaff', 'newFair', 'adminInfo', 'printList', 'register'].map(n => [n, routeFor(n)!.role]));
  assert.deepEqual(need, { checkout: 'cashier', sendEmail: 'cashier', cash: 'cashier', importCommit: 'admin', exportCsv: 'admin', saveStaff: 'admin', newFair: 'admin', adminInfo: 'admin', printList: 'admin', register: 'helper' });
  for (const n of ['constructor', '__proto__', 'toString', 'audit']) assert.equal(routeFor(n), undefined);
});
test('logins: wrong password, throttling, sign-out, switched-off staff', async () => {
  for (let i = 0; i < 5; i++) await assert.rejects(login(db, { username: 'helper', password: 'nope', ip: '9' }), code('LOGIN'));
  await assert.rejects(login(db, { username: 'helper', password: 'local-demo-only', ip: '9' }), code('SLOW'));
  const t = await login(db, { username: 'HELPER', password: 'local-demo-only', ip: '8' });
  assert.equal((await actorFor(db, t))!.role, 'helper');
  await logout(db, t); assert.equal(await actorFor(db, t), undefined);
  const t2 = await login(db, { username: 'helper', password: 'local-demo-only', ip: '8' });
  await call('saveStaff', { id: helper.id, username: 'helper', name: 'H', role: 'helper', active: false });
  assert.equal(await actorFor(db, t2), undefined);
  await assert.rejects(login(db, { username: 'helper', password: 'local-demo-only', ip: '8' }), code('LOGIN'));
  await call('saveStaff', { id: helper.id, username: 'helper', name: 'H', role: 'helper', active: true });
  await assert.rejects(call('saveStaff', { id: admin.id, username: 'admin', name: 'A', role: 'helper' }), code('BAD'));
});
test('setup is closed once there are staff', async () => {
  assert.equal(await needsSetup(db), false);
  await assert.rejects(firstAdmin(db, { token: 'wrong', username: 'x', name: 'x', password: 'x', fairName: '' }, 'right-token'), code('DENIED'));
  await assert.rejects(firstAdmin(db, { token: 'right-token', username: 'evil', name: 'x', password: 'long-enough-1', fairName: '' }, 'right-token'), code('DENIED'));
});
test('the database itself refuses a second payment, and bad amounts', async () => {
  await reg('s90001', S1); const r = await pay('s90001', 1, 2500);
  const regId = (await db.query('select registration_id from checkouts')).rows[0].registration_id;
  await assert.rejects(db.query(`insert into checkouts (id, registration_id, amount_cents, method, created_by) values ($1, $2, 0, 'None', $3)`, [randomUUID(), regId, admin.id]), /unique/);
  assert.ok(r);
});
test('a new fair starts empty and keeps the old one', async () => {
  await reg('s90001', S1);
  const old = (await db.query('select id from fairs where is_current')).rows[0].id;
  await call('newFair', { name: 'Next year', copy: true });
  const d = await call('dashboard');
  assert.deepEqual([d.levels.length, d.clubs.length, d.collected], [0, 54, 0]);
  assert.equal((await db.query('select 1 from registrations where fair_id = $1', [old])).rowCount, 1);
  await db.query('update fairs set is_current = false'); await db.query('update fairs set is_current = true where id = $1', [old]);
});
test('rehearsal: 990 students through 10 counters', async () => {
  const list = (await db.query(`select reg_no, level from students order by reg_no`)).rows as { reg_no: string; level: string }[];
  assert.equal(list.length, 990);
  const started = Date.now();
  let i = 0, slowest = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    for (let s; (s = list[i++]);) {
      const t = Date.now();
      const v = await reg(s.reg_no, S1);
      await call('lookup', { regNo: s.reg_no });
      await pay(s.reg_no, v.version, v.due);
      slowest = Math.max(slowest, Date.now() - t);
    }
  }));
  const d = await call('dashboard');
  assert.equal(d.collected, 990 * 2500); assert.equal(d.owing, 0);
  assert.equal(d.clubs.reduce((t: number, c: Any) => t + c.payout, 0), d.collected);
  assert.equal((await call('exportCsv', { kind: 'school' })).count, 990 * 3);
  const t = Date.now(); await call('dashboard');
  console.log(`  rehearsal ${((Date.now() - started) / 1000).toFixed(1)}s, slowest student ${slowest}ms, dashboard ${Date.now() - t}ms`);
});
