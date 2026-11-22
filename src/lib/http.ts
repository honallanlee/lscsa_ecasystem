import { UserError } from './errors.ts';

/** Only this site's own pages may post here; other websites are refused. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try { return Boolean(origin && host && new URL(origin).host === host && req.headers.get('content-type')?.startsWith('application/json')); } catch { return false; }
}
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > 2_000_000) throw new UserError('BAD', 'That file is too large.');
  try {
    const v: unknown = JSON.parse(raw || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* falls through */ }
  throw new UserError('BAD', 'Please reload the page and try again.');
}
const STATUS: Record<string, number> = { SIGNIN: 401, DENIED: 403, NOT_FOUND: 404, CONFLICT: 409, PAID: 409, SLOW: 429 };
export function failure(e: unknown, where: string): Response {
  if (e instanceof UserError) return Response.json({ ok: false, code: e.code, message: e.message }, { status: STATUS[e.code] ?? 400 });
  console.error(where, e);
  return Response.json({ ok: false, code: 'ERROR', message: 'Something went wrong. Look the student up again to see whether it saved.' }, { status: 500 });
}
