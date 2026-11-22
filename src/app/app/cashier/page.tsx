import { requireRole } from '../../../lib/session.ts';
import { Cashier } from '../../../components/cashier.tsx';

export const metadata = { title: 'Cashier' };

export default async function Page() {
  await requireRole('cashier');
  return <Cashier />;
}
