import { redirect } from 'next/navigation';
import { needsSetup } from '../../lib/auth.ts';
import { getDb } from '../../lib/db.ts';
import { currentActor } from '../../lib/session.ts';
import { AuthForm } from '../../components/auth-form.tsx';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function Login() {
  if (await needsSetup(getDb())) redirect('/setup');
  if (await currentActor()) redirect('/app/register');
  return <AuthForm what="login" />;
}
