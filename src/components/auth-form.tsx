'use client';
import Image from 'next/image';
import { useState, type FormEvent } from 'react';
import { auth, errorText } from './client.ts';
import { Field, Notice } from './ui.tsx';

export function AuthForm({ what }: { what: 'login' | 'setup' }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), setup = what === 'setup';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await auth(what, Object.fromEntries(new FormData(e.currentTarget))); location.href = '/app/' + (setup ? 'admin' : 'register'); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  }
  return (
    <main className="signin">
      <Image src="/logo.png" alt="" width={84} height={84} priority />
      <h1>{setup ? 'Create the first admin' : 'Staff sign in'}</h1>
      <form onSubmit={submit} className="card stack">
        {setup && <>
          <Field label="Setup code" hint="The SETUP_TOKEN you chose when deploying."><input name="token" type="password" required autoComplete="off" /></Field>
          <Field label="Fair name"><input name="fairName" defaultValue="La Salle College ECA Promotion Fair" maxLength={100} /></Field>
          <Field label="Your name"><input name="name" required maxLength={80} autoComplete="name" /></Field>
        </>}
        <Field label="Username"><input name="username" required autoFocus={!setup} autoCapitalize="none" autoComplete="username" /></Field>
        <Field label="Password" hint={setup ? 'At least 10 characters.' : undefined}><input name="password" type="password" required minLength={setup ? 10 : undefined} autoComplete={setup ? 'new-password' : 'current-password'} /></Field>
        {error && <Notice kind="bad">{error}</Notice>}
        <button className="btn" disabled={busy}>{busy ? 'One moment…' : setup ? 'Create admin' : 'Sign in'}</button>
      </form>
    </main>
  );
}
