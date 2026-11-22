import Image from 'next/image';
import Link from 'next/link';
import { NOTICE } from '../lib/email.ts';

export default function Home() {
  return (
    <main className="landing">
      <Image src="/logo.png" alt="La Salle College Student Association crest" width={132} height={132} priority />
      <h1>ECA Promotion Fair</h1>
      <p className="lede">Scan a student, pick their clubs, take the payment. The rules are checked as you go.</p>
      <Link className="btn big" href="/app/register">Open the app</Link>
      <dl className="steps">
        <div><dt>Requirement check</dt><dd>Clubs are matched to each form&rsquo;s rules before anything is saved.</dd></div>
        <div><dt>Cashier</dt><dd>One clear amount, change worked out, and no student charged twice.</dd></div>
        <div><dt>Close of day</dt><dd>Balance the cash box and hand the school one file.</dd></div>
      </dl>
      <footer>{NOTICE} Built by Allan Lee, 2016&ndash;{new Date().getFullYear()}.</footer>
    </main>
  );
}
