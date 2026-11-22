'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { atLeast, type Role } from '../lib/rules.ts';
import { useApp } from './app-context.tsx';
import { auth } from './client.ts';

const LINKS: [string, string, Role][] = [['register', 'Register', 'helper'], ['cashier', 'Cashier', 'cashier'], ['dashboard', 'Dashboard', 'helper'], ['notes', 'Notes', 'helper'], ['admin', 'Admin', 'admin']];

export function Nav() {
  const { me, fairName } = useApp(), path = usePathname();
  const signOut = async () => { await auth('logout').catch(() => {}); location.href = '/login'; };
  return (
    <header className="nav">
      <Link href="/" className="brand"><Image src="/logo.png" alt="" width={40} height={40} /><span>{fairName}</span></Link>
      <nav aria-label="Sections">
        {LINKS.filter(l => atLeast(me.role, l[2])).map(([slug, label]) => (
          <Link key={slug} href={'/app/' + slug} aria-current={path === '/app/' + slug ? 'page' : undefined}>{label}</Link>
        ))}
      </nav>
      <div className="who"><span>{me.name}</span><button className="link" onClick={signOut}>Sign out</button></div>
    </header>
  );
}
