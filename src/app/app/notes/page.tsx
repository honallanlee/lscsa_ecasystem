import { requireRole } from '../../../lib/session.ts';
import { Notes } from '../../../components/notes.tsx';

export const metadata = { title: 'Notes' };

export default async function Page() {
  await requireRole('helper');
  return <Notes />;
}
