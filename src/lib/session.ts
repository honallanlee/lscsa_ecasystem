import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { actorFor, type Actor } from './auth.ts';
import { getDb } from './db.ts';
import { atLeast, type Role } from './rules.ts';

export const COOKIE = 'eca_session';
export const currentActor = cache(async (): Promise<Actor | undefined> => {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? actorFor(getDb(), token) : undefined;
});
export async function requireRole(role: Role): Promise<Actor> {
  const me = await currentActor();
  if (!me) redirect('/login');
  if (!atLeast(me.role, role)) redirect('/app/register');
  return me;
}
