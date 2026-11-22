import { requireRole } from '../../../lib/session.ts';
import { Dashboard } from '../../../components/dashboard.tsx';

export const metadata = { title: 'Dashboard' };

export default async function Page() {
  await requireRole('helper');
  return <Dashboard />;
}
