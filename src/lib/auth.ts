import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { one, rows, transaction, type Db, type Tx } from './db.ts';
import { UserError, bad } from './errors.ts';
import { ROLES, type Role } from './rules.ts';

export type Actor = { id: string; username: string; name: string; role: Role };
export const SESSION_HOURS = 12;

const derive = (password: string, salt: Buffer) => new Promise<Buffer>((ok, fail) =>
  scrypt(password.normalize('NFKC'), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `s1$${salt.toString('base64')}$${(await derive(password, salt)).toString('base64')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [v, salt, hash] = stored.split('$');
  if (v !== 's1' || !salt || !hash) return false;
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'base64')), Buffer.from(hash, 'base64'));
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const sameSecret = (a: string, b: string) => timingSafeEqual(Buffer.from(sha(a)), Buffer.from(sha(b)));

export function checkNewStaff(p: { username?: unknown; name?: unknown; role?: unknown; password?: unknown }, needPassword: boolean) {
  const username = String(p.username ?? '').trim().toLowerCase(), name = String(p.name ?? '').trim().slice(0, 80);
  const role = p.role as Role, password = String(p.password ?? '');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Usernames are 3 to 40 letters, numbers, dots, dashes or underscores.');
  if (!name) throw bad('Enter a name.');
  if (!ROLES.includes(role)) throw bad('Choose a role.');
  if ((needPassword || password) && (password.length < 10 || password.length > 200)) throw bad('Passwords need at least 10 characters.');
  return { username, name, role, password };
}

let dummy: Promise<string> | undefined;
const SLOW = 'Too many wrong passwords. Wait 15 minutes and try again.';

/** Returns a session token, or throws. Unknown users take as long as wrong passwords. */
export async function login(db: Db, p: { username: unknown; password: unknown; ip: string }): Promise<string> {
  const username = String(p.username ?? '').trim().toLowerCase().slice(0, 60), password = String(p.password ?? '').slice(0, 200);
  const f = await one<{ pair: number; ip: number; who: number }>(db,
    `select count(*) filter (where username = $1 and ip = $2)::int as pair, count(*) filter (where ip = $2)::int as ip,
            count(*) filter (where username = $1)::int as who
     from login_failures where at > now() - interval '15 minutes'`, [username, p.ip]);
  if (f && (f.pair >= 5 || f.ip >= 30 || f.who >= 50)) throw new UserError('SLOW', SLOW);
  const s = await one<{ id: string; password_hash: string }>(db, 'select id, password_hash from staff where username = $1 and active', [username]);
  const ok = await verifyPassword(password, s?.password_hash ?? await (dummy ??= hashPassword(randomBytes(12).toString('hex'))));
  if (!s || !ok) {
    await db.query('insert into login_failures (username, ip) values ($1, $2)', [username, p.ip]);
    await db.query(`delete from login_failures where at < now() - interval '1 day'`);
    throw new UserError('LOGIN', 'Wrong username or password.');
  }
  await db.query('delete from login_failures where username = $1 and ip = $2', [username, p.ip]);
  await db.query('delete from sessions where expires_at < now()');
  return newSession(db, s.id);
}

export async function newSession(db: Tx, staffId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(`insert into sessions values ($1, $2, now() + make_interval(hours => $3))`, [sha(token), staffId, SESSION_HOURS]);
  return token;
}
export async function actorFor(db: Db, token: string | undefined): Promise<Actor | undefined> {
  if (!token) return undefined;
  return one<Actor>(db, `select s.id, s.username, s.name, s.role from sessions x join staff s on s.id = x.staff_id
    where x.token_hash = $1 and x.expires_at > now() and s.active`, [sha(token)]);
}
export async function logout(db: Db, token: string) { await db.query('delete from sessions where token_hash = $1', [sha(token)]); }

export async function needsSetup(db: Db): Promise<boolean> { return !(await one(db, 'select 1 from staff limit 1')); }

/** Creates the first admin. Works only while there are no staff, and only with the deploy's SETUP_TOKEN. */
export async function firstAdmin(db: Db, p: { token: unknown; username: unknown; name: unknown; password: unknown; fairName: unknown }, expected: string | undefined): Promise<string> {
  if (!expected || expected.length < 8 || !sameSecret(String(p.token ?? ''), expected)) throw new UserError('DENIED', 'The setup code is not correct.');
  const s = checkNewStaff({ ...p, role: 'admin' }, true);
  const hash = await hashPassword(s.password);
  return transaction(db, async tx => {
    await tx.query('lock table staff in share row exclusive mode');
    if ((await rows(tx, 'select 1 from staff limit 1')).length) throw new UserError('DENIED', 'Setup has already been done.');
    const row = await one<{ id: string }>(tx, `insert into staff (username, name, role, password_hash) values ($1, $2, 'admin', $3) returning id`, [s.username, s.name, hash]);
    if (!(await one(tx, 'select 1 from fairs where is_current'))) {
      await tx.query('insert into fairs (name, is_current) values ($1, true)', [String(p.fairName ?? '').trim().slice(0, 100) || 'ECA Promotion Fair']);
    }
    return newSession(tx, row!.id);
  });
}
