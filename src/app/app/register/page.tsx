import { requireRole } from '../../../lib/session.ts';
import { Register } from '../../../components/register.tsx';

export const metadata = { title: 'Register' };

export default async function Page() {
  await requireRole('helper');
  return <Register />;
}
