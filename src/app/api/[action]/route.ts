import { getDb } from '../../../lib/db.ts';
import { UserError } from '../../../lib/errors.ts';
import { failure, readBody, sameOrigin } from '../../../lib/http.ts';
import { atLeast } from '../../../lib/rules.ts';
import { routeFor } from '../../../lib/service.ts';
import { currentActor } from '../../../lib/session.ts';

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  try {
    if (!sameOrigin(req)) throw new UserError('DENIED', 'This request was refused.');
    const me = await currentActor();
    if (!me) throw new UserError('SIGNIN', 'Please sign in again.');
    const route = routeFor(action);
    if (!route) throw new UserError('NOT_FOUND', 'Unknown action.');
    if (!atLeast(me.role, route.role)) throw new UserError('DENIED', 'You do not have permission to do this.');
    return Response.json({ ok: true, data: await route.run({ db: getDb(), me }, await readBody(req)) });
  } catch (e) { return failure(e, action); }
}
