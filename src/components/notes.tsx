'use client';
import { useRef, useState, type FormEvent } from 'react';
import { classify } from '../lib/scan.ts';
import { call, errorText, when } from './client.ts';
import { ScanPanel } from './scan-panel.tsx';
import { isComputer, useMode } from './mode.tsx';
import { signal } from './signal.ts';
import { go, useWedge } from './use-wedge.ts';
import { Field, Notice, Person, RegInput, useLoad, useRequestId, useStudent } from './ui.tsx';

export function Notes() {
  const st = useStudent(), req = useRequestId(), list = useLoad(() => call('noteList'), 30_000);
  const [reg, setReg] = useState(''), [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [cameraOn, setCamera] = useState(false), camera = useMode() === 'phone' && cameraOn;
  const regRef = useRef<HTMLInputElement>(null), noteRef = useRef<HTMLTextAreaElement>(null);
  async function find(value: string) {
    setError(''); setReg(value); req.done();
    const x = await st.find(value);
    if (isComputer()) setTimeout(() => go(x ? noteRef.current : regRef.current), 20);
    return x;
  }
  useWedge(async ({ text: code, field, before }) => {
    const s = classify(code, new Set());
    if (field === 'note') { if (s.kind !== 'student' || before.trim()) return; setText(before); }
    if (s.kind === 'student') { if (!(await find(s.regNo))) signal(false); return; }
    setReg(''); setError('That is not a student’s slip.'); signal(false);
    setTimeout(() => go(regRef.current), 20);
  }, t => classify(t, new Set()).kind === 'student');
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!st.found || busy) return;
    setBusy(true); setError('');
    try {
      await call('noteAdd', { requestId: req.get(), regNo: st.found.student.regNo, text });
      req.done(); setText(''); setReg(''); st.clear(); await list.reload(); if (isComputer()) go(regRef.current);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function remove(id: string) { try { await call('noteRemove', { id }); await list.reload(); } catch (e) { setError(errorText(e)); } }
  return (
    <>
      <h1>Notes</h1>
      <RegInput value={reg} onChange={x => { setReg(x); if (st.found || st.error) st.clear(); }} onFind={x => void find(x)} inputRef={regRef} loading={st.loading} camera={camera && !st.found} onCamera={on => { st.clear(); setReg(''); setCamera(on); }} />
      {camera && !st.found && <ScanPanel hint="Scan the student’s slip" onClose={() => setCamera(false)} onScan={async t => {
        const s = classify(t, new Set());
        if (s.kind !== 'student') return { ok: false, message: 'That is not a student’s slip.' };
        if (st.loading) return { ok: false, message: 'One moment…', retry: true };
        return (await find(s.regNo)) ? { ok: true, message: 'Found.' } : { ok: false, message: `No student found for ${s.regNo}.` };
      }} />}
      {(st.error || error || list.error) && <Notice kind="bad">{st.error || error || list.error}</Notice>}
      {st.found && <form className="stack narrow" onSubmit={add}><Person v={st.found} /><Field label="New note"><textarea value={text} onChange={e => setText(e.target.value)} maxLength={500} rows={3} required ref={noteRef} data-field="note" /></Field><button className="btn" disabled={busy}>Add note</button></form>}
      <h2>All notes</h2>
      {list.data?.length === 0 && <p className="muted">No notes yet. Find a student above to add one.</p>}
      <ul className="notes">{list.data?.map(n => <li key={n.id}><div><b>{n.who}</b> <span className="muted">{n.regNo}</span><p>{n.body}</p><small className="muted">{n.by}, {when(n.at)}</small></div><button className="link" onClick={() => remove(n.id)}>Remove</button></li>)}</ul>
    </>
  );
}
