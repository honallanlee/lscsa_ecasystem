'use client';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { normReg } from '../lib/rules.ts';
import { call, errorText, type Data } from './client.ts';
import { isComputer, useMode } from './mode.tsx';

export function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Notice({ kind, children }: { kind: 'good' | 'bad' | 'warn'; children: ReactNode }) {
  return <p className={'notice ' + kind} role={kind === 'bad' ? 'alert' : 'status'}>{children}</p>;
}
const STATUS = { NONE: ['Not registered', ''], REGISTERED: ['Registered, not paid', 'warn'], AMENDED: ['Changed, needs cashier', 'warn'], CONFIRMED: ['Paid and confirmed', 'good'] } as const;
export const StatusTag = ({ status }: { status: keyof typeof STATUS }) => <span className={'tag ' + STATUS[status][1]}>{STATUS[status][0]}</span>;

export type Found = Data<'lookup'>;
/**
 * Student lookup shared by every counter. Each search gets a number, and only the newest
 * answer is used, so a slow reply can never put the previous student on screen.
 */
export function useStudent() {
  const [found, setFound] = useState<Found | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const turn = useRef(0);
  async function find(reg: string) {
    const mine = ++turn.current, regNo = normReg(reg);
    setFound(null); setError('');
    if (!regNo) { setLoading(false); if (reg.trim()) setError('That is not a registration number.'); return null; }
    setLoading(true);
    try {
      const v = await call('lookup', { regNo });
      if (mine !== turn.current) return null;
      setFound(v);
      return v;
    } catch (e) { if (mine === turn.current) setError(errorText(e)); return null; }
    finally { if (mine === turn.current) setLoading(false); }
  }
  function clear() { turn.current++; setFound(null); setError(''); setLoading(false); }
  return { found, setFound, error, loading, find, clear };
}

export function RegInput({ value, onChange, onFind, inputRef, loading, camera, onCamera }: { value: string; onChange: (v: string) => void; onFind: (v: string) => void; inputRef: RefObject<HTMLInputElement | null>; loading: boolean; camera: boolean; onCamera: (on: boolean) => void }) {
  const mode = useMode();
  // On phones, moving the cursor pops the keyboard up over the camera, so only do it on a computer.
  useEffect(() => { if (isComputer()) inputRef.current?.focus(); }, [inputRef]);
  return (
    <form className={camera ? 'scan filming' : 'scan'} onSubmit={e => { e.preventDefault(); onFind(value); }}>
      <Field label="Student registration number"><input ref={inputRef} data-field="reg" readOnly={loading} value={value} onChange={e => onChange(e.target.value)} placeholder="Scan or type" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
        onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey && value.trim()) { e.preventDefault(); onFind(value); } }} /></Field>
      <button className="btn quiet" disabled={loading}>{loading ? 'Finding…' : 'Find'}</button>
      {mode === 'phone' && !camera && <button type="button" className="btn" onClick={() => onCamera(true)}>Use camera</button>}
    </form>
  );
}
export function Person({ v }: { v: Found }) {
  const s = v.student;
  return (
    <section className="person">
      <div><h2>{s.name} {s.nameAlt && <span lang="zh-Hant">{s.nameAlt}</span>}</h2><p>{s.regNo} · Form {s.level} · Class {s.cls} ({s.classNo})</p></div>
      <StatusTag status={v.status} />
      {v.notes.map(n => <p key={n.id} className="notice warn">Note: {n.body}</p>)}
    </section>
  );
}
/** Same id until the save succeeds, so pressing again after a dropped connection cannot save twice. */
export function useRequestId() {
  const id = useRef('');
  return { get: () => (id.current ||= crypto.randomUUID()), done: () => { id.current = ''; } };
}
export function useLoad<T>(load: () => Promise<T>, everyMs = 0) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState('');
  const fn = useRef(load);
  fn.current = load;
  const reload = async () => { try { setData(await fn.current()); setError(''); } catch (e) { setError(errorText(e)); } };
  useEffect(() => {
    void reload();
    if (!everyMs) return;
    const t = setInterval(() => { if (!document.hidden) void reload(); }, everyMs);
    return () => clearInterval(t);
  }, [everyMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload };
}
