import { requireRole } from '../../../lib/session.ts';
import { Print } from '../../../components/print.tsx';

export const metadata = { title: 'Print' };

export default async function Page() {
  await requireRole('admin');
  return <Print />;
}
