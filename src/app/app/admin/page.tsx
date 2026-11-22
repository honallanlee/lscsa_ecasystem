import { requireRole } from '../../../lib/session.ts';
import { Admin } from '../../../components/admin.tsx';

export const metadata = { title: 'Admin' };

export default async function Page() {
  await requireRole('admin');
  return <Admin />;
}
