import type { ReactNode } from 'react';
import { getDb } from '../../lib/db.ts';
import { requireRole } from '../../lib/session.ts';
import { routeFor, type Routes } from '../../lib/service.ts';
import { NOTICE } from '../../lib/email.ts';
import { AppProvider } from '../../components/app-context.tsx';
import { ModeSwitch } from '../../components/mode.tsx';
import { Nav } from '../../components/nav.tsx';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireRole('helper');
  const boot = await routeFor('bootstrap')!.run({ db: getDb(), me }, {}) as Routes['bootstrap'];
  return (
    <AppProvider value={boot}>
      <Nav />
      <main className="page">{children}</main>
      <footer className="foot"><ModeSwitch /><p>{NOTICE}</p></footer>
    </AppProvider>
  );
}
