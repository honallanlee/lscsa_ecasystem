'use client';
import { useMemo, useRef, useState } from 'react';
import { CATEGORIES, checkChoices, money, normCode } from '../lib/rules.ts';
import { addClub, classify } from '../lib/scan.ts';
import { useApp } from './app-context.tsx';
import { ApiError, call, errorText } from './client.ts';
import { ScanPanel, type ScanReply } from './scan-panel.tsx';
import { isComputer, useMode } from './mode.tsx';
import { signal } from './signal.ts';
import { Field, Notice, Person, RegInput, useRequestId, useStudent } from './ui.tsx';
import { go, useWedge } from './use-wedge.ts';

export function Register() {
  const { clubs, rules } = useApp(), st = useStudent(), req = useRequestId();
  const [reg, setReg] = useState(''), [phone, setPhone] = useState(''), [codes, setCodes] = useState<string[]>([]), [cameraOn, setCamera] = useState(false), [said, setSaid] = useState<ScanReply | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  const regRef = useRef<HTMLInputElement>(null), phoneRef = useRef<HTMLInputElement>(null), clubRefs = useRef<(HTMLInputElement | null)[]>([]), finding = useRef(false);
  const camera = useMode() === 'phone' && cameraOn;
  const byCode = useMemo(() => new Map(clubs.map(c => [c.code, c])), [clubs]), clubCodes = useMemo(() => new Set(clubs.map(c => c.code)), [clubs]);
  const v = st.found, rule = v && rules.find(r => r.level === v.student.level), max = rule?.max ?? 0;
  const check = checkChoices(codes, clubs, rule ?? undefined);
  const phoneOk = /^\d{8}$/.test(phone.replace(/\s+/g, '')), canSave = !busy && phoneOk && check.errors.length === 0;
  const dirty = Boolean(v) && (phone.trim() !== v!.phone || codes.map(normCode).filter(Boolean).join() !== v!.clubs.map(c => c.code).join());

  async function find(value: string) {
    setError(''); setDone(''); setSaid(null); req.done(); setCodes([]); setPhone(''); setReg(value);
    finding.current = true;
    const x = await st.find(value);
    finding.current = false;
    if (!x) { if (isComputer()) regRef.current?.select(); return null; }
    const mine = x.clubs.map(c => c.code), slots = Math.max(rules.find(r => r.level === x.student.level)?.max ?? 0, mine.length);
    setCodes(Array.from({ length: slots }, (_, i) => mine[i] ?? ''));
    setPhone(x.phone);
    if (isComputer()) setTimeout(() => {
      const empty = mine.length < slots ? mine.length : 0;
      go(x.phone ? clubRefs.current[empty] ?? document.getElementById('save') : phoneRef.current);
    }, 20);
    return x;
  }
  function reset() { st.clear(); setSaid(null); setReg(''); setPhone(''); setCodes([]); setError(''); req.done(); if (isComputer()) setTimeout(() => regRef.current?.focus()); }
  async function save() {
    if (!v || busy) return;
    setBusy(true); setError('');
    try {
      const r = await call('register', { requestId: req.get(), regNo: v.student.regNo, phone, codes: codes.filter(c => c.trim()), baseVersion: v.version });
      setDone(`Saved ${r.student.name}. ` + (r.due > 0 ? `${money(r.due)} to pay at the cashier.` : r.due < 0 ? `${money(-r.due)} to refund at the cashier.` : r.status === 'CONFIRMED' ? 'Nothing changed.' : 'Nothing to pay, but the cashier still confirms.'));
      reset();
      if (camera) scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.code !== 'OFFLINE' && e.code !== 'ERROR') req.done();
    } finally { setBusy(false); }
  }
  /** One camera session does the whole job: a slip opens the student, then club labels fill the slots. */
  async function scanned(text: string): Promise<ScanReply> {
    if (busy || finding.current) return { ok: false, message: 'One moment…', retry: true };
    const s = classify(text, clubCodes);
    if (s.kind === 'unknown') return { ok: false, message: `“${s.text}” is not a student or a club.` };
    if (s.kind === 'student') {
      if (v?.student.regNo === s.regNo) return { ok: true, message: `${v.student.name} is already open. Scan club labels.` };
      if (dirty) return { ok: false, message: `Save or clear ${v!.student.name} first.` };
      const x = await find(s.regNo);
      return x ? { ok: true, message: `${x.student.name}, ${x.student.cls}. ${x.phone || camera ? 'Now scan club labels.' : 'Enter the phone number, then scan club labels.'}` } : { ok: false, message: `No student found for ${s.regNo}.` };
    }
    if (!v) return { ok: false, message: 'Scan the student’s slip first.' };
    const club = byCode.get(s.code)!, next = addClub(codes, s.code, max);
    if (next.result === 'already') return { ok: true, message: `${club.name} is already added.` };
    if (next.result === 'full') return { ok: false, message: `Form ${v.student.level} can only choose ${max}.` };
    setCodes(next.codes); req.done();
    return { ok: true, message: `Added ${club.name}.` };
  }
  const edit = (i: number, value: string) => { req.done(); setSaid(null); setCodes(codes.map((x, j) => (j === i ? value : x))); };
  /** Club 1, 2, 3… After the last one, the Register button, or whatever still needs filling in first. */
  function next(i: number) {
    if (i < codes.length) return go(clubRefs.current[i]);
    const button = document.getElementById('save') as HTMLButtonElement | null;
    if (button && !button.disabled) return go(button);
    const missing = /^\d{8}$/.test(phoneRef.current?.value.replace(/\s+/g, '') ?? '') ? clubRefs.current.find(el => el?.isConnected && !el.value.trim()) : phoneRef.current;
    go(missing ?? clubRefs.current[codes.length - 1]);
  }

  const latest = useRef({ scanned, next, codes });
  latest.current = { scanned, next, codes };

  /** A handheld scan. It is understood by what it says, not by which box the cursor happened to be in. */
  useWedge(async ({ text, field, before }) => {
    if (busy) return;
    const s = classify(text, clubCodes), slot = field.startsWith('club-') ? Number(field.slice(5)) : -1;
    const restore = () => {
      if (field === 'reg') setReg(v ? v.student.regNo : '');
      else if (field === 'phone') setPhone(before);
      else if (slot >= 0) setCodes(codes.map((x, j) => (j === slot ? before : x)));
    };
    const say = (r: ScanReply) => { if (!r.ok) signal(false); setSaid(r); };
    if (slot >= 0 && v && s.kind === 'club') {
      const others = codes.map((x, j) => (j === slot ? '' : x));
      if (others.some(x => normCode(x) === s.code)) {
        restore();
        say({ ok: false, message: `${byCode.get(s.code)!.name} is already added.` });
        setTimeout(() => go(clubRefs.current[slot]), 20);
      } else {
        edit(slot, s.code);
        setTimeout(() => next(slot + 1), 20);
      }
      return;
    }
    if (slot >= 0 && s.kind === 'unknown') {
      edit(slot, s.text);
      say({ ok: false, message: `There is no club “${s.text}”.` });
      setTimeout(() => go(clubRefs.current[slot]), 20);
      return;
    }
    // Take the scanner's own letters back out, and let the page catch up, before judging what has changed.
    restore();
    await new Promise(done => setTimeout(done, 20));
    const r = await latest.current.scanned(text);
    say(r);
    if (s.kind === 'student' && r.ok && v?.student.regNo !== s.regNo) return; // find() has already moved the cursor
    setTimeout(() => {
      if (!v || s.kind !== 'club') { if (field === 'reg' || !v) go(regRef.current); return; }
      const empty = latest.current.codes.findIndex(c => !c.trim());
      latest.current.next(empty < 0 ? codes.length : empty);
    }, 20);
  }, t => classify(t, clubCodes).kind !== 'unknown');

  return (
    <>
      <h1>Register clubs</h1>
      <RegInput value={reg} onChange={x => { setReg(x); setSaid(null); if (v || st.error) { st.clear(); setCodes([]); setPhone(''); } }} onFind={find} inputRef={regRef} loading={st.loading} camera={camera} onCamera={setCamera} />
      {camera && <ScanPanel hint={v ? 'Scan club labels' : 'Scan the student’s slip'} onScan={scanned} onClose={() => setCamera(false)} />}
      {!camera && said && <Notice kind={said.ok ? 'good' : 'bad'}>{said.message}</Notice>}
      {st.error && !said && <Notice kind="bad">{st.error}</Notice>}
      {done && <Notice kind="good">{done}</Notice>}
      {v && <div className="two">
        <div className="stack">
          <Person v={v} />
          {v.status === 'CONFIRMED' && <Notice kind="warn">Already paid {money(v.paid)}. Changing clubs sends the student back to the cashier.</Notice>}
          <Field label="Phone number"><input ref={phoneRef} data-field="phone" value={phone} onChange={e => { setPhone(e.target.value); req.done(); }} inputMode="numeric" maxLength={11} enterKeyHint="next" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (isComputer()) next(0); else e.currentTarget.blur(); } }} /></Field>
          <div className="choices">
            {codes.map((c, i) => {
              const club = byCode.get(normCode(c));
              return (
                <div key={i} className="choice">
                  <Field label={`Club ${i + 1}`}><input ref={el => { clubRefs.current[i] = el; }} data-field={`club-${i}`} value={c} list="clubs" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                    aria-invalid={Boolean(c.trim()) && !club} onChange={e => edit(i, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setTimeout(() => next(i + 1), 20); } }} /></Field>
                  <p>{club ? <><b>{club.name}</b><span>{club.category}</span><span className="num">{money(club.fee)}</span></> : c.trim() ? <span className="no">No such club</span> : null}
                    {c.trim() && <button type="button" tabIndex={-1} className="link" onClick={() => edit(i, '')} aria-label={`Remove club ${i + 1}`}>Remove</button>}</p>
                </div>
              );
            })}
          </div>
          <datalist id="clubs">{clubs.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</datalist>
        </div>
        <aside className="card stack side">
          <h2>Form {v.student.level} rules</h2>
          {rule ? <ul className="checks">
            {CATEGORIES.filter(k => rule[k] > 0 || check.counts[k] > 0).map(k => <li key={k} className={check.counts[k] >= rule[k] ? 'ok' : ''}><span>{k}</span><span className="num">{rule[k] ? `${check.counts[k]} of ${rule[k]}` : check.counts[k]}</span></li>)}
            <li className={check.clubs.length >= rule.min && check.clubs.length <= rule.max ? 'ok' : ''}><span>Clubs in total</span><span className="num">{check.clubs.length}, needs {rule.min === rule.max ? rule.min : `${rule.min} to ${rule.max}`}</span></li>
          </ul> : <Notice kind="bad">No rule is set for this form level.</Notice>}
          <div className="total"><span>Total fee</span><b className="num">{money(check.total)}</b></div>
          {v.paid > 0 && <div className="total small"><span>{check.total - v.paid < 0 ? 'Refund' : 'Still to pay'}</span><b className="num">{money(Math.abs(check.total - v.paid))}</b></div>}
          {!phoneOk && <p className="why">Enter an 8-digit phone number.</p>}
          {check.errors.filter(x => !x.startsWith('Needs')).map(x => <p key={x} className="why">{x}</p>)}
          {error && <Notice kind="bad">{error}</Notice>}
          <button id="save" className="btn big" onClick={save} disabled={!canSave}>{busy ? 'Saving…' : v.version ? 'Save changes' : 'Register'}</button>
          <button className="btn quiet" onClick={reset} disabled={busy}>Clear</button>
        </aside>
      </div>}
    </>
  );
}
