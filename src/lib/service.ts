// Everything staff can do. `routes` at the bottom is the complete list, with the role each one needs.
import { checkNewStaff, hashPassword, verifyPassword, type Actor } from './auth.ts';
import { one, rows, transaction, type Db, type Tx } from './db.ts';
import { UserError, bad } from './errors.ts';
import { buildEmail, emailCap, emailReady, resendSender, type Sender } from './email.ts';
import { CATEGORIES, MAX_CHOICES, PAY_METHODS, checkChoices, money, normCode, normReg, parseCents, type Club, type Role, type Rule } from './rules.ts';
import { parseCsv, toCsv } from './csv.ts';

export type Payload = Record<string, unknown>;
export type Ctx = { db: Db; me: Actor; send?: Sender };
type Fair = { id: string; name: string; contact_name: string; contact_phone: string; contact_email: string; email_domain: string };
type Status = {
  fair_id: string; reg_no: string; level: string; name: string; name_alt: string; class: string; class_no: string; email: string;
  registration_id: string | null; version: number; phone: string | null; total_cents: number; paid_cents: number; due_cents: number;
  confirmed_version: number; confirmed_registration_id: string | null; status: 'NONE' | 'REGISTERED' | 'AMENDED' | 'CONFIRMED';
};
export type ClubLine = { code: string; name: string; category: string; fee: number };

const HK_DAY = `(now() at time zone 'Asia/Hong_Kong')::date`;

function uuid(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) throw bad('Please reload the page and try again.');
  return s;
}
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

async function fair(db: Tx): Promise<Fair> {
  const f = await one<Fair>(db, 'select * from fairs where is_current');
  if (!f) throw new UserError('SETUP', 'No fair has been set up yet.');
  return f;
}
async function audit(tx: Tx, me: Actor, action: string, detail = '') {
  await tx.query('insert into audit (staff_id, action, detail) values ($1, $2, $3)', [me.id, action, detail.slice(0, 1000)]);
}
async function clubsOf(db: Tx, fairId: string): Promise<Club[]> {
  return rows<Club>(db, 'select code, name, category, fee_cents as fee from clubs where fair_id = $1 and active order by code', [fairId]);
}
async function rulesOf(db: Tx, fairId: string): Promise<Rule[]> {
  return rows<Rule>(db, `select level, academic as "Academic", cultural as "Cultural", interest as "Interest", service as "Service",
    sports as "Sports", min_clubs as min, max_clubs as max from rules where fair_id = $1 order by level`, [fairId]);
}
async function linesOf(db: Tx, registrationId: string | null): Promise<ClubLine[]> {
  return registrationId ? rows<ClubLine>(db, 'select code, name, category, fee_cents as fee from registration_clubs where registration_id = $1 order by position', [registrationId]) : [];
}

/** Reads a student's position. With lock, other counters wait until this transaction ends. */
async function student(db: Tx, fairId: string, reg: unknown, lock = false): Promise<Status> {
  const regNo = normReg(reg);
  if (!regNo) throw bad('That is not a registration number.');
  if (lock) await db.query('select 1 from students where fair_id = $1 and reg_no = $2 for update', [fairId, regNo]);
  const s = await one<Status>(db, 'select * from student_status where fair_id = $1 and reg_no = $2', [fairId, regNo]);
  if (!s) throw new UserError('NOT_FOUND', `No student with number ${regNo}.`);
  return s;
}
async function view(db: Tx, s: Status) {
  return {
    student: { regNo: s.reg_no, level: s.level, name: s.name, nameAlt: s.name_alt, cls: s.class, classNo: s.class_no, email: s.email },
    status: s.status, version: s.version, total: s.total_cents, paid: s.paid_cents, due: s.due_cents, phone: s.phone ?? '', clubs: await linesOf(db, s.registration_id)
  };
}

async function bootstrap({ db, me }: Ctx) {
  const f = await fair(db);
  const [clubs, rules] = await Promise.all([clubsOf(db, f.id), rulesOf(db, f.id)]);
  return { me: { name: me.name, role: me.role }, fairName: f.name, clubs, rules, emailReady: emailReady() };
}

async function lookup({ db }: Ctx, p: Payload) {
  const f = await fair(db), s = await student(db, f.id, p.regNo);
  const notes = await rows<{ id: string; body: string; by: string; at: Date }>(db, `select n.id, n.body, s.name as by, n.created_at as at from notes n join staff s on s.id = n.created_by
    where fair_id = $1 and reg_no = $2 and removed_at is null order by n.created_at desc`, [f.id, s.reg_no]);
  const history = await rows<{ id: string; version: number; amount: number; method: string; at: Date; email: string | null }>(db, `select c.id, r.version, c.amount_cents as amount, c.method, c.created_at as at,
    (select status from emails e where e.checkout_id = c.id order by e.created_at desc limit 1) as email
    from checkouts c join registrations r on r.id = c.registration_id where r.fair_id = $1 and r.reg_no = $2 order by r.version desc`, [f.id, s.reg_no]);
  return { ...(await view(db, s)), notes, history };
}

async function register({ db, me }: Ctx, p: Payload) {
  const id = uuid(p.requestId), phone = String(p.phone ?? '').replace(/\s+/g, '');
  if (!/^\d{8}$/.test(phone)) throw bad('The phone number must be 8 digits.');
  if (!Array.isArray(p.codes) || p.codes.length > MAX_CHOICES) throw bad('Too many clubs.');
  const codes = p.codes as unknown[];
  return transaction(db, async tx => {
    const f = await fair(tx), s = await student(tx, f.id, p.regNo, true);
    const repeat = await one<{ reg_no: string; fair_id: string }>(tx, 'select reg_no, fair_id from registrations where id = $1', [id]);
    if (repeat) {
      if (repeat.reg_no !== s.reg_no || repeat.fair_id !== f.id) throw bad('Please reload the page and try again.');
      return view(tx, s);
    }
    if (Number(p.baseVersion) !== s.version) throw new UserError('CONFLICT', 'Someone else just changed this student. Look them up again.');
    const rule = (await rulesOf(tx, f.id)).find(r => r.level === s.level);
    const check = checkChoices(codes, await clubsOf(tx, f.id), rule);
    if (check.errors.length) throw new UserError('RULES', check.errors.join(' '));
    const before = await linesOf(tx, s.registration_id);
    const same = s.version > 0 && s.phone === phone && s.total_cents === check.total && before.map(c => c.code).join() === check.clubs.map(c => c.code).join();
    if (same) return view(tx, s);
    await tx.query('insert into registrations (id, fair_id, reg_no, version, phone, total_cents, created_by) values ($1, $2, $3, $4, $5, $6, $7)',
      [id, f.id, s.reg_no, s.version + 1, phone, check.total, me.id]);
    for (const [i, c] of check.clubs.entries()) {
      await tx.query('insert into registration_clubs values ($1, $2, $3, $4, $5, $6)', [id, c.code, i, c.name, c.category, c.fee]);
    }
    await audit(tx, me, s.version ? 'amend' : 'register', `${s.reg_no} v${s.version + 1} ${check.clubs.map(c => c.code).join(',')} ${money(check.total)}`);
    return view(tx, await student(tx, f.id, s.reg_no));
  });
}

type CheckoutRow = { id: string; amount_cents: number; method: string; change_cents: number; reg_no: string };
async function checkout({ db, me }: Ctx, p: Payload) {
  const id = uuid(p.requestId);
  return transaction(db, async tx => {
    const f = await fair(tx), s = await student(tx, f.id, p.regNo, true);
    const receipt = (c: Omit<CheckoutRow, 'reg_no'>, repeat: boolean) => ({ checkoutId: c.id, regNo: s.reg_no, name: s.name, email: s.email, amount: c.amount_cents, method: c.method, change: c.change_cents, repeat });
    const old = await one<CheckoutRow>(tx, 'select c.*, r.reg_no from checkouts c join registrations r on r.id = c.registration_id where c.id = $1', [id]);
    if (old) {
      if (old.reg_no !== s.reg_no) throw bad('Please reload the page and try again.');
      return receipt(old, true);
    }
    if (s.status === 'NONE') throw bad('This student has not registered any clubs yet.');
    if (s.status === 'CONFIRMED') throw new UserError('PAID', 'Already paid and confirmed. Nothing was charged.');
    if (Number(p.version) !== s.version || Number(p.due) !== s.due_cents) throw new UserError('CONFLICT', 'The clubs or the amount changed since you looked this student up. Look them up again.');
    const due = s.due_cents;
    let method = 'None', tendered = 0;
    if (due !== 0) {
      method = String(p.method ?? '');
      if (!(PAY_METHODS as readonly string[]).includes(method)) throw bad('Choose how the money was paid.');
    }
    if (due > 0) {
      const got = method === 'Cash' ? parseCents(p.tendered) : due;
      if (got === null || got < due) throw bad(`The amount received is less than ${money(due)}.`);
      tendered = got;
    }
    const row = { id, amount_cents: due, method, change_cents: due > 0 ? tendered - due : 0 };
    await tx.query('insert into checkouts (id, registration_id, amount_cents, method, tendered_cents, change_cents, created_by) values ($1, $2, $3, $4, $5, $6, $7)',
      [id, s.registration_id, due, method, tendered, row.change_cents, me.id]);
    await audit(tx, me, due < 0 ? 'refund' : 'checkout', `${s.reg_no} v${s.version} ${money(due)} ${method}`);
    return receipt(row, false);
  });
}

/** Sent only when staff ask. The row is written first, so the monthly cap holds even if two people press at once. */
async function sendEmail({ db, me, send = resendSender }: Ctx, p: Payload) {
  const checkoutId = uuid(p.checkoutId);
  if (send === resendSender && !emailReady()) throw bad('Email is not set up. The registration itself is saved.');
  const job = await transaction(db, async tx => {
    await tx.query('select pg_advisory_xact_lock(7240032)');
    const f = await fair(tx);
    const c = await one<{ amount_cents: number; created_at: Date; registration_id: string; version: number; phone: string; total_cents: number; reg_no: string; name: string; class: string; class_no: string; email: string }>(tx,
      `select c.amount_cents, c.created_at, r.id as registration_id, r.version, r.phone, r.total_cents, s.reg_no, s.name, s.class, s.class_no, s.email
       from checkouts c join registrations r on r.id = c.registration_id join students s on s.fair_id = r.fair_id and s.reg_no = r.reg_no
       where c.id = $1 and r.fair_id = $2`, [checkoutId, f.id]);
    if (!c) throw new UserError('NOT_FOUND', 'That payment no longer exists.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) throw bad('This student has no email address.');
    const sentLately = await one(tx, `select 1 from emails where checkout_id = $1 and status <> 'FAILED' and created_at > now() - interval '2 minutes'`, [checkoutId]);
    if (sentLately) throw bad('A confirmation was already sent in the last two minutes.');
    const used = await one<{ n: number }>(tx, `select count(*)::int as n from emails where status <> 'FAILED'
      and created_at >= date_trunc('month', now() at time zone 'Asia/Hong_Kong') at time zone 'Asia/Hong_Kong'`);
    if (used!.n >= emailCap()) throw bad(`This month's limit of ${emailCap()} emails is used up.`);
    const e = await one<{ id: string }>(tx, 'insert into emails (checkout_id, recipient, requested_by) values ($1, $2, $3) returning id', [checkoutId, c.email, me.id]);
    const msg = buildEmail({ fairName: f.name, regNo: c.reg_no, name: c.name, cls: c.class, classNo: c.class_no, phone: c.phone, at: c.created_at, version: c.version,
      total: c.total_cents, amount: c.amount_cents, clubs: await linesOf(tx, c.registration_id), contact: { name: f.contact_name, phone: f.contact_phone, email: f.contact_email } }, c.email);
    return { id: e!.id, msg };
  });
  try {
    await send(job.msg, job.id);
    await db.query(`update emails set status = 'SENT' where id = $1`, [job.id]);
    return { to: job.msg.to };
  } catch (e) {
    await db.query(`update emails set status = 'FAILED', error = $2 where id = $1`, [job.id, String((e as Error).message).slice(0, 300)]);
    throw new UserError('EMAIL', 'The email could not be sent. The registration itself is saved.');
  }
}

async function noteAdd({ db, me }: Ctx, p: Payload) {
  const id = uuid(p.requestId), body = String(p.text ?? '').trim();
  if (!body || body.length > 500) throw bad('A note must be 1 to 500 characters.');
  const f = await fair(db), s = await student(db, f.id, p.regNo);
  await db.query('insert into notes (id, fair_id, reg_no, body, created_by) values ($1, $2, $3, $4, $5) on conflict (id) do nothing', [id, f.id, s.reg_no, body, me.id]);
  return { id };
}
async function noteRemove({ db, me }: Ctx, p: Payload) {
  return transaction(db, async tx => {
    const n = await one<{ reg_no: string }>(tx, 'update notes set removed_at = now() where id = $1 and removed_at is null returning reg_no', [uuid(p.id)]);
    if (n) await audit(tx, me, 'note removed', n.reg_no);
    return {};
  });
}
async function noteList({ db }: Ctx) {
  const f = await fair(db);
  return rows<{ id: string; body: string; by: string; at: Date; regNo: string; who: string }>(db, `select n.id, n.body, u.name as by, n.created_at as at, n.reg_no as "regNo",
    s.name || ' (' || s.class || ' ' || s.class_no || ')' as who
    from notes n join staff u on u.id = n.created_by join students s using (fair_id, reg_no)
    where n.fair_id = $1 and n.removed_at is null order by n.created_at desc limit 300`, [f.id]);
}

async function dashboard({ db }: Ctx) {
  const f = await fair(db);
  const [levels, clubs, sums] = await Promise.all([
    rows<{ level: string; total: number; registered: number; confirmed: number }>(db, `select level, count(*)::int as total, count(*) filter (where status <> 'NONE')::int as registered,
      count(*) filter (where status = 'CONFIRMED')::int as confirmed from student_status where fair_id = $1 group by level order by level`, [f.id]),
    // Payouts come from settled registrations, not from sign-ups.
    rows<{ code: string; name: string; category: string; signups: number; confirmed: number; payout: number }>(db, `
      with st as materialized (select registration_id, confirmed_registration_id from student_status where fair_id = $1),
      a as (select rc.code, count(*)::int as n from st join registration_clubs rc on rc.registration_id = st.registration_id group by 1),
      b as (select rc.code, count(*)::int as n, sum(rc.fee_cents)::int as fee from st join registration_clubs rc on rc.registration_id = st.confirmed_registration_id group by 1)
      select c.code, c.name, c.category, coalesce(a.n, 0) as signups, coalesce(b.n, 0) as confirmed, coalesce(b.fee, 0) as payout
      from clubs c left join a using (code) left join b using (code) where c.fair_id = $1 and (c.active or a.n > 0 or b.n > 0) order by signups desc, c.code`, [f.id]),
    one<{ collected: number; due: number; owing: number }>(db, `select coalesce(sum(paid_cents), 0)::int as collected,
      coalesce(sum(due_cents), 0)::int as due, count(*) filter (where status in ('REGISTERED', 'AMENDED'))::int as owing from student_status where fair_id = $1`, [f.id])
  ]);
  return { levels, clubs, ...sums! };
}

async function cashFor(db: Tx, fairId: string) {
  return rows<{ method: string; total: number; count: number }>(db, `select m.method, coalesce(sum(c.amount_cents), 0)::int as total, count(c.id)::int as count
    from unnest($2::text[]) with ordinality as m(method, n)
    left join (select c.* from checkouts c join registrations r on r.id = c.registration_id
      where r.fair_id = $1 and (c.created_at at time zone 'Asia/Hong_Kong')::date = ${HK_DAY}) c on c.method = m.method
    group by m.method, m.n order by m.n`, [fairId, PAY_METHODS]);
}
async function cash({ db }: Ctx) {
  const f = await fair(db);
  const [methods, cashiers, counts] = await Promise.all([
    cashFor(db, f.id),
    rows<{ name: string; count: number; total: number }>(db, `select s.name, count(*)::int as count, sum(c.amount_cents)::int as total from checkouts c
      join registrations r on r.id = c.registration_id join staff s on s.id = c.created_by
      where r.fair_id = $1 and (c.created_at at time zone 'Asia/Hong_Kong')::date = ${HK_DAY} group by s.id order by s.name`, [f.id]),
    rows<{ id: string; method: string; expected: number; counted: number; remark: string; by: string; at: Date }>(db, `select c.id, method, expected_cents as expected, counted_cents as counted,
      remark, s.name as by, c.created_at as at from cashups c join staff s on s.id = c.created_by where fair_id = $1 and day = ${HK_DAY} order by c.created_at desc`, [f.id])
  ]);
  return { methods, cashiers, counts };
}
async function cashup({ db, me }: Ctx, p: Payload) {
  const id = uuid(p.requestId), counted = parseCents(p.counted), method = String(p.method ?? '');
  if (counted === null) throw bad('Enter the amount you counted.');
  if (!(PAY_METHODS as readonly string[]).includes(method)) throw bad('Choose a payment method.');
  return transaction(db, async tx => {
    const f = await fair(tx), expected = (await cashFor(tx, f.id)).find(m => m.method === method)!.total;
    await tx.query(`insert into cashups (id, fair_id, day, method, expected_cents, counted_cents, remark, created_by) values ($1, $2, ${HK_DAY}, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
      [id, f.id, method, expected, counted, text(p.remark, 300), me.id]);
    return { expected, counted, difference: counted - expected };
  });
}

// ---- Admin ----------------------------------------------------------------
const IMPORTS: Record<string, Record<string, string[]>> = {
  students: { regNo: ['regno', 'registration number'], level: ['classlevel', 'level'], name: ['studentname_eng', 'studentname eng', 'name'], cls: ['class'],
    classNo: ['classno', 'class no'], nameAlt: ['studentname_chi', 'studentname chi', 'name alt'], email: ['email'] },
  clubs: { code: ['club code', 'code'], name: ['club name', 'name'], fee: ['fee'], category: ['category'] },
  rules: { level: ['requirements', 'classlevel', 'level'], Academic: ['no. of academic', 'academic'], Cultural: ['no. of cultural', 'cultural'], Interest: ['no. of interest', 'interest'],
    Service: ['no. of service', 'service'], Sports: ['no. of sports', 'sports'], min: ['min club', 'min clubs', 'min'], max: ['max club', 'max clubs', 'max'] }
};
const OPTIONAL = ['nameAlt', 'email'];
type Row = Record<string, string | number>;

/** Reads a CSV, collecting every problem instead of stopping at the first. */
export function parseImport(kind: string, csv: string, domain: string): { rows: Row[]; errors: string[] } {
  const spec = Object.hasOwn(IMPORTS, kind) ? IMPORTS[kind]! : undefined;
  if (!spec) throw bad('Unknown list.');
  const table = parseCsv(csv), errors: string[] = [], out: Row[] = [], seen = new Set<string>();
  if (table.length < 2) return { rows: [], errors: ['The file has no data rows.'] };
  const head = table[0]!.map(h => h.trim().toLowerCase()), at: Record<string, number> = {};
  for (const [f, names] of Object.entries(spec)) {
    at[f] = head.findIndex(h => names.includes(h));
    if (at[f] < 0 && !OPTIONAL.includes(f)) errors.push(`Missing column: ${names[0]}.`);
  }
  if (errors.length) return { rows: [], errors };
  table.slice(1).forEach((r, i) => {
    const problem = (m: string) => errors.push(`Row ${i + 2}: ${m}`);
    const v = Object.fromEntries(Object.keys(spec).map(f => [f, (at[f]! < 0 ? '' : r[at[f]!] ?? '').trim()])) as Record<string, string>;
    const o: Row = { ...v };
    let key = '';
    if (kind === 'students') {
      o.regNo = key = normReg(v.regNo);
      if (!key) problem(`"${v.regNo}" is not a registration number.`);
      for (const f of ['level', 'name', 'cls', 'classNo']) if (!v[f]) problem(`${f} is empty.`);
      if (!v.email) o.email = domain && key ? `${key}@${domain}` : '';
    } else if (kind === 'clubs') {
      o.code = key = normCode(v.code);
      if (!/^[A-Z0-9]{2,8}$/.test(key)) problem(`"${v.code}" is not a club code.`);
      if (!v.name) problem('the club name is empty.');
      const fee = parseCents(v.fee);
      if (fee === null) problem(`"${v.fee}" is not a fee.`);
      o.fee = fee ?? 0;
      if (!(CATEGORIES as readonly string[]).includes(v.category!)) problem(`"${v.category}" is not a category.`);
    } else {
      key = v.level!;
      if (!key) problem('the form level is empty.');
      for (const f of [...CATEGORIES, 'min', 'max']) { if (!/^\d{1,2}$/.test(v[f]!)) problem(`${f} must be a whole number.`); o[f] = Number(v[f]); }
      const need = CATEGORIES.reduce((t, c) => t + Number(o[c]), 0);
      if (Number(o.min) > Number(o.max)) problem('min is more than max.');
      if (need > Number(o.max)) problem('the category requirements add up to more than max.');
      if (Number(o.max) > MAX_CHOICES) problem(`max cannot be more than ${MAX_CHOICES}.`);
    }
    if (key && seen.has(key)) problem(`${key} appears more than once.`);
    seen.add(key);
    out.push(o);
  });
  return { rows: out, errors };
}

async function importPreview({ db }: Ctx, p: Payload) {
  const f = await fair(db), kind = String(p.kind), r = parseImport(kind, String(p.csv ?? ''), f.email_domain), warnings: string[] = [];
  if (!r.errors.length && kind === 'students') {
    const kept = r.rows.map(x => x.regNo);
    const gone = await one<{ n: number }>(db, `select count(*)::int as n from student_status where fair_id = $1 and status <> 'NONE' and reg_no <> all($2)`, [f.id, kept]);
    if (gone!.n) warnings.push(`${gone!.n} registered student(s) are not in this file. They will be kept.`);
    const levels = new Set((await rulesOf(db, f.id)).map(x => x.level));
    const missing = [...new Set(r.rows.map(x => String(x.level)))].filter(l => !levels.has(l));
    if (missing.length) warnings.push(`No rule yet for: ${missing.join(', ')}.`);
  }
  if (!r.errors.length && kind === 'clubs') {
    const codes = new Set(r.rows.map(x => x.code));
    const gone = (await clubsOf(db, f.id)).filter(c => !codes.has(c.code));
    if (gone.length) warnings.push(`${gone.length} current club(s) will be closed to new sign-ups: ${gone.map(c => c.code).join(', ')}.`);
  }
  return { count: r.rows.length, errors: r.errors.slice(0, 20), errorCount: r.errors.length, warnings, sample: r.rows.slice(0, 5) };
}

async function importCommit({ db, me }: Ctx, p: Payload) {
  return transaction(db, async tx => {
    const f = await fair(tx), kind = String(p.kind), r = parseImport(kind, String(p.csv ?? ''), f.email_domain);
    if (r.errors.length) throw bad('The file has errors. Nothing was changed.');
    const json = JSON.stringify(r.rows);
    if (kind === 'students') {
      await tx.query(`insert into students (fair_id, reg_no, level, name, name_alt, class, class_no, email)
        select $1, x."regNo", x.level, x.name, x."nameAlt", x.cls, x."classNo", x.email
        from jsonb_to_recordset($2::jsonb) as x("regNo" text, level text, name text, "nameAlt" text, cls text, "classNo" text, email text)
        on conflict (fair_id, reg_no) do update set level = excluded.level, name = excluded.name, name_alt = excluded.name_alt, class = excluded.class, class_no = excluded.class_no, email = excluded.email`, [f.id, json]);
      await tx.query(`delete from students s where fair_id = $1 and reg_no <> all($2)
        and not exists (select 1 from registrations r where r.fair_id = s.fair_id and r.reg_no = s.reg_no)
        and not exists (select 1 from notes n where n.fair_id = s.fair_id and n.reg_no = s.reg_no)`, [f.id, r.rows.map(x => x.regNo)]);
    } else if (kind === 'clubs') {
      await tx.query('update clubs set active = false where fair_id = $1', [f.id]);
      await tx.query(`insert into clubs (fair_id, code, name, category, fee_cents) select $1, x.code, x.name, x.category, x.fee
        from jsonb_to_recordset($2::jsonb) as x(code text, name text, category text, fee int)
        on conflict (fair_id, code) do update set name = excluded.name, category = excluded.category, fee_cents = excluded.fee_cents, active = true`, [f.id, json]);
    } else {
      await tx.query('delete from rules where fair_id = $1', [f.id]);
      await tx.query(`insert into rules select $1, x.level, x."Academic", x."Cultural", x."Interest", x."Service", x."Sports", x.min, x.max
        from jsonb_to_recordset($2::jsonb) as x(level text, "Academic" int, "Cultural" int, "Interest" int, "Service" int, "Sports" int, min int, max int)`, [f.id, json]);
    }
    await audit(tx, me, 'import', `${kind} ${r.rows.length}`);
    return { count: r.rows.length };
  });
}

async function exportCsv({ db, me }: Ctx, p: Payload) {
  const f = await fair(db), kind = String(p.kind);
  const queries: Record<string, [string, string[]]> = {
    school: [`select st.class, st.class_no, st.reg_no, st.name, rc.name as club, 'Member', st.phone from student_status st
      join registration_clubs rc on rc.registration_id = st.registration_id where st.fair_id = $1 ${p.confirmedOnly ? `and st.status = 'CONFIRMED'` : ''} order by rc.code, st.reg_no`,
      ['Class', 'Class No', 'Student Reg No', 'Eng Name', 'Club Name', 'Club Position', 'Mobile Number']],
    absent: [`select level, class, class_no, reg_no, name, email from student_status where fair_id = $1 and status = 'NONE' order by class, reg_no`, ['Level', 'Class', 'Class No', 'Student Reg No', 'Eng Name', 'Email']],
    owing: [`select class, class_no, reg_no, name, status, total_cents / 100.0, paid_cents / 100.0, due_cents / 100.0, phone from student_status
      where fair_id = $1 and status in ('REGISTERED', 'AMENDED') order by class, reg_no`, ['Class', 'Class No', 'Student Reg No', 'Eng Name', 'Status', 'Total', 'Paid', 'Balance due', 'Phone']],
    payments: [`select c.created_at, s.name, r.reg_no, r.version, c.amount_cents / 100.0, c.method, c.tendered_cents / 100.0, c.change_cents / 100.0 from checkouts c
      join registrations r on r.id = c.registration_id join staff s on s.id = c.created_by where r.fair_id = $1 order by c.created_at`, ['Time', 'Cashier', 'Student Reg No', 'Version', 'Amount', 'Method', 'Received', 'Change']],
    audit: [`select a.at, s.username, a.action, a.detail from audit a left join staff s on s.id = a.staff_id where $1::uuid is not null order by a.id`, ['Time', 'Staff', 'Action', 'Detail']]
  };
  if (!Object.hasOwn(queries, kind)) throw bad('Unknown export.');
  const [sql, head] = queries[kind]!;
  const data = (await db.query({ text: sql, values: [f.id], rowMode: 'array' })).rows as unknown[][];
  const body = data.map(r => r.map(v => (v instanceof Date ? v.toISOString() : typeof v === 'string' && /^-?\d+\.\d{10,}$/.test(v) ? Number(v).toFixed(2) : v)));
  await audit(db, me, 'export', kind);
  return { filename: `eca-${kind}.csv`, csv: toCsv([head, ...body]), count: body.length };
}

async function adminInfo({ db }: Ctx) {
  const f = await fair(db);
  const [staff, fairs, counts, emails] = await Promise.all([
    rows<{ id: string; username: string; name: string; role: Role; active: boolean }>(db, 'select id, username, name, role, active from staff order by active desc, username'),
    rows<{ id: string; name: string; isCurrent: boolean }>(db, 'select id, name, is_current as "isCurrent" from fairs order by created_at desc'),
    one<{ students: number; clubs: number; rules: number }>(db, `select (select count(*)::int from students where fair_id = $1) as students,
      (select count(*)::int from clubs where fair_id = $1 and active) as clubs, (select count(*)::int from rules where fair_id = $1) as rules`, [f.id]),
    one<{ n: number }>(db, `select count(*)::int as n from emails where status <> 'FAILED' and created_at >= date_trunc('month', now() at time zone 'Asia/Hong_Kong') at time zone 'Asia/Hong_Kong'`)
  ]);
  return { staff, fairs, counts: counts!, email: { ready: emailReady(), used: emails!.n, cap: emailCap() },
    settings: { name: f.name, contactName: f.contact_name, contactPhone: f.contact_phone, contactEmail: f.contact_email, emailDomain: f.email_domain } };
}
/** For printing slips. Loads one class at a time. */
async function printList({ db }: Ctx, p: Payload) {
  const f = await fair(db);
  const [classes, students] = await Promise.all([
    rows<{ c: string }>(db, 'select distinct class as c from students where fair_id = $1 order by 1', [f.id]),
    rows<{ regNo: string; name: string; nameAlt: string; level: string; cls: string; classNo: string }>(db, `select reg_no as "regNo", name, name_alt as "nameAlt", level, class as cls, class_no as "classNo"
      from students where fair_id = $1 and class = $2 order by length(class_no), class_no, reg_no`, [f.id, text(p.cls, 20)])
  ]);
  return { classes: classes.map(x => x.c), students };
}
async function saveSettings({ db, me }: Ctx, p: Payload) {
  const name = text(p.name, 100), email = text(p.contactEmail, 120), domain = text(p.emailDomain, 100).toLowerCase();
  if (!name) throw bad('Enter the fair name.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('The contact email is not valid.');
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw bad('The email domain is not valid.');
  return transaction(db, async tx => {
    await tx.query('update fairs set name = $1, contact_name = $2, contact_phone = $3, contact_email = $4, email_domain = $5 where is_current', [name, text(p.contactName, 80), text(p.contactPhone, 40), email, domain]);
    await audit(tx, me, 'settings', name);
    return {};
  });
}
async function saveStaff({ db, me }: Ctx, p: Payload) {
  const id = p.id ? uuid(p.id) : null, active = p.active !== false, s = checkNewStaff(p, !id);
  if (id === me.id && (s.role !== 'admin' || !active)) throw bad('You cannot remove your own admin access.');
  const hash = s.password ? await hashPassword(s.password) : null;
  return transaction(db, async tx => {
    const taken = await one(tx, 'select 1 from staff where username = $1 and id is distinct from $2', [s.username, id]);
    if (taken) throw bad('That username is already used.');
    if (id) {
      const r = await tx.query('update staff set username = $2, name = $3, role = $4, active = $5, password_hash = coalesce($6, password_hash) where id = $1', [id, s.username, s.name, s.role, active, hash]);
      if (!r.rowCount) throw new UserError('NOT_FOUND', 'That person no longer exists.');
      if (hash || !active) await tx.query('delete from sessions where staff_id = $1 and ($2 or staff_id <> $3)', [id, !active, me.id]);
    } else await tx.query('insert into staff (username, name, role, password_hash) values ($1, $2, $3, $4)', [s.username, s.name, s.role, hash]);
    await audit(tx, me, 'staff', `${s.username}=${s.role}${active ? '' : ' (off)'}${hash ? ' password set' : ''}`);
    return {};
  });
}
async function changePassword({ db, me }: Ctx, p: Payload) {
  const row = await one<{ password_hash: string }>(db, 'select password_hash from staff where id = $1', [me.id]);
  if (!row || !(await verifyPassword(String(p.current ?? '').slice(0, 200), row.password_hash))) throw bad('Your current password is not correct.');
  const next = String(p.next ?? '');
  if (next.length < 10 || next.length > 200) throw bad('Passwords need at least 10 characters.');
  await db.query('update staff set password_hash = $2 where id = $1', [me.id, await hashPassword(next)]);
  return {};
}
/** Starts an empty fair. The old one stays in the database; clubs and rules can be copied over. */
async function newFair({ db, me }: Ctx, p: Payload) {
  const name = text(p.name, 100);
  if (!name) throw bad('Enter a name for the new fair.');
  return transaction(db, async tx => {
    const old = await fair(tx);
    await tx.query('select 1 from fairs where id = $1 for update', [old.id]);
    await tx.query('update fairs set is_current = false where is_current');
    const n = await one<{ id: string }>(tx, `insert into fairs (name, is_current, contact_name, contact_phone, contact_email, email_domain) values ($1, true, $2, $3, $4, $5) returning id`,
      [name, old.contact_name, old.contact_phone, old.contact_email, old.email_domain]);
    if (p.copy) {
      await tx.query('insert into clubs select $2, code, name, category, fee_cents, true from clubs where fair_id = $1 and active', [old.id, n!.id]);
      await tx.query('insert into rules select $2, level, academic, cultural, interest, service, sports, min_clubs, max_clubs from rules where fair_id = $1', [old.id, n!.id]);
    }
    await audit(tx, me, 'new fair', name);
    return {};
  });
}

const routes = {
  bootstrap: ['helper', bootstrap], lookup: ['helper', lookup], register: ['helper', register], dashboard: ['helper', dashboard], changePassword: ['helper', changePassword],
  noteAdd: ['helper', noteAdd], noteRemove: ['helper', noteRemove], noteList: ['helper', noteList],
  checkout: ['cashier', checkout], sendEmail: ['cashier', sendEmail], cash: ['cashier', cash], cashup: ['cashier', cashup],
  importPreview: ['admin', importPreview], importCommit: ['admin', importCommit], exportCsv: ['admin', exportCsv], adminInfo: ['admin', adminInfo],
  saveSettings: ['admin', saveSettings], saveStaff: ['admin', saveStaff], printList: ['admin', printList], newFair: ['admin', newFair]
} as const;
export type Routes = { [K in keyof typeof routes]: Awaited<ReturnType<(typeof routes)[K][1]>> };
type Handler = (c: Ctx, p: Payload) => Promise<unknown>;

export function routeFor(name: string): { role: Role; run: Handler } | undefined {
  if (!Object.hasOwn(routes, name)) return undefined;
  const [role, run] = routes[name as keyof typeof routes];
  return { role, run: run as Handler };
}
