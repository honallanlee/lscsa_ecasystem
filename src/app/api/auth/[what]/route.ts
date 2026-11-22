import { cookies } from 'next/headers';
import { SESSION_HOURS, firstAdmin, login, logout } from '../../../../lib/auth.ts';
import { getDb } from '../../../../lib/db.ts';
import { UserError } from '../../../../lib/errors.ts';
import { failure, readBody, sameOrigin } from '../../../../lib/http.ts';
import { COOKIE } from '../../../../lib/session.ts';

export async function POST(req: Request, { params }: { params: Promise<{ what: string }> }) {
  const { what } = await params;
  try {
    if (!sameOrigin(req)) throw new UserError('DENIED', 'This request was refused.');
    const jar = await cookies(), db = getDb();
    if (what === 'logout') {
      const old = jar.get(COOKIE)?.value;
      if (old) await logout(db, old);
      jar.delete(COOKIE);
      return Response.json({ ok: true, data: {} });
    }
    const p = await readBody(req);
    let token: string;
    if (what === 'login') token = await login(db, { username: p.username, password: p.password, ip: (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim() });
    else if (what === 'setup') token = await firstAdmin(db, p as Parameters<typeof firstAdmin>[1], process.env.SETUP_TOKEN);
    else throw new UserError('NOT_FOUND', 'Unknown action.');
    jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_HOURS * 3600 });
    return Response.json({ ok: true, data: {} });
  } catch (e) { return failure(e, what); }
}
