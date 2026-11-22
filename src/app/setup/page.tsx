import { redirect } from 'next/navigation';
import { needsSetup } from '../../lib/auth.ts';
import { getDb } from '../../lib/db.ts';
import { AuthForm } from '../../components/auth-form.tsx';

export const metadata = { title: 'Set up' };
export const dynamic = 'force-dynamic';

export default async function Setup() {
  if (!(await needsSetup(getDb()))) redirect('/login');
  return <AuthForm what="setup" />;
}
