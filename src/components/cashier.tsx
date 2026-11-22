'use client';
import { useMemo, useRef, useState } from 'react';
import { PAY_METHODS, money, parseCents } from '../lib/rules.ts';
import { classify } from '../lib/scan.ts';
import { useApp } from './app-context.tsx';
import { ApiError, call, errorText, when, type Data } from './client.ts';
import { ScanPanel, type ScanReply } from './scan-panel.tsx';
import { isComputer, useMode } from './mode.tsx';
import { signal } from './signal.ts';
import { Field, Notice, Person, RegInput, useRequestId, useStudent } from './ui.tsx';
import { go, useWedge } from './use-wedge.ts';

export function Cashier() {
  const { emailReady, clubs } = useApp(), clubCodes = useMemo(() => new Set(clubs.map(c => c.code)), [clubs]), st = useStudent(), req = useRequestId();
  const [reg, setReg] = useState(''), [method, setMethod] = useState<string>('Cash'), [tendered, setTendered] = useState('');
  const [cameraOn, setCamera] = useState(false), camera = useMode() === 'phone' && cameraOn, finding = useRef(false);
  const [busy, setBusy] = useState(false), [scanError, setScanError] = useState(''), [error, setError] = useState(''), [receipt, setReceipt] = useState<Data<'checkout'> | null>(null), [mail, setMail] = useState('');
  const regRef = useRef<HTMLInputElement>(null), cashRef = useRef<HTMLInputElement>(null);
  const v = st.found, due = v?.due ?? 0, got = parseCents(tendered);
  const settle = v && (v.status === 'REGISTERED' || v.status === 'AMENDED');
  const ready = settle && (due <= 0 || method !== 'Cash' || (got !== null && got >= due));

  async function find(value: string) {
    setError(''); setScanError(''); setReceipt(null); setMail(''); setTendered(''); setMethod('Cash'); req.done(); setReg(value);
    finding.current = true;
    const x = await st.find(value);
    finding.current = false;
    if (isComputer()) setTimeout(() => {
      if (!x || x.status === 'NONE' || x.status === 'CONFIRMED') go(regRef.current); // the next scan replaces this one
      else go(x.due > 0 ? cashRef.current : document.getElementById('pay'));
    }, 20);
    return x;
  }
  /** The camera steps aside once a student is open, and comes back after the payment. */
  async function scanned(text: string): Promise<ScanReply> {
    if (busy || finding.current) return { ok: false, message: 'One moment…', retry: true };
    const s = classify(text, clubCodes);
    if (s.kind !== 'student') return { ok: false, message: s.kind === 'club' ? 'That is a club label. Scan the student’s slip.' : `“${s.text}” is not a student.` };
    return (await find(s.regNo)) ? { ok: true, message: 'Found.' } : { ok: false, message: `No student found for ${s.regNo}.` };
  }
  /** A handheld scan opens the student from anywhere on the page, and never presses the payment button. */
  useWedge(async ({ text, field, before }) => {
    if (busy) return;
    if (field === 'cash') setTendered(before);
    const r = await scanned(text);
    if (r.ok) return;
    signal(false); setScanError(r.message);
    if (classify(text, clubCodes).kind === 'student') return; // not found: find() has already reset the page
    setReg(v ? v.student.regNo : '');
    setTimeout(() => go(v && due > 0 && method === 'Cash' ? cashRef.current : regRef.current), 20);
  }, t => classify(t, clubCodes).kind === 'student');

  async function pay() {
    if (!v || !ready || busy) return;
    setBusy(true); setError('');
    try {
      const r = await call('checkout', { requestId: req.get(), regNo: v.student.regNo, version: v.version, due: v.due, method, tendered });
      req.done(); setReceipt(r); st.clear(); setReg(''); setTendered('');
      if (isComputer()) setTimeout(() => go(regRef.current), 20);
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.code !== 'OFFLINE' && e.code !== 'ERROR') req.done();
    } finally { setBusy(false); }
  }
  async function email(checkoutId: string) {
    setMail('Sending…');
    try { setMail('Sent to ' + (await call('sendEmail', { checkoutId })).to + '.'); } catch (e) { setMail(errorText(e)); }
  }
  return (
    <>
      <h1>Cashier</h1>
      <RegInput value={reg} onChange={x => { setReg(x); setScanError(''); if (v || st.error) { st.clear(); setTendered(''); setError(''); } }} onFind={find} inputRef={regRef} loading={st.loading} camera={camera && !v} onCamera={on => { st.clear(); setReg(''); setTendered(''); setError(''); req.done(); setCamera(on); }} />
      {camera && !v && <ScanPanel hint="Scan the student’s slip" onScan={scanned} onClose={() => setCamera(false)} />}
      {(scanError || st.error) && <Notice kind="bad">{scanError || st.error}</Notice>}
      {receipt && <section className="card receipt" role="status">
        <p>{receipt.name} ({receipt.regNo}) is confirmed.</p>
        {receipt.amount > 0 && <p className="huge num">{receipt.change > 0 ? <>Change {money(receipt.change)}</> : <>{money(receipt.amount)} received</>}</p>}
        {receipt.amount < 0 && <p className="huge num">Refund {money(-receipt.amount)}</p>}
        <div className="row">
          {emailReady && receipt.email && <button className="btn quiet" disabled={mail === 'Sending…' || mail.startsWith('Sent')} onClick={() => email(receipt.checkoutId)}>Email confirmation</button>}
          {mail && <span role="status">{mail}</span>}
        </div>
      </section>}
      {v && <div className="two">
        <div className="stack">
          <Person v={v} />
          {v.clubs.length > 0 ? <table><thead><tr><th>Club</th><th>Category</th><th className="num">Fee</th></tr></thead>
            <tbody>{v.clubs.map(c => <tr key={c.code}><td>{c.name}</td><td>{c.category}</td><td className="num">{money(c.fee)}</td></tr>)}</tbody></table>
            : <p className="muted">{v.status === 'NONE' ? 'Send this student to Register first.' : 'No clubs chosen.'}</p>}
          {v.history.length > 0 && <details><summary>Earlier payments</summary><table><tbody>
            {v.history.map(h => <tr key={h.id}><td>{when(h.at)}</td><td>{h.method}</td><td className="num">{money(h.amount)}</td>
              <td>{emailReady && <button className="link" onClick={() => email(h.id)}>{h.email === 'SENT' ? 'Email again' : 'Email'}</button>}</td></tr>)}
          </tbody></table>{mail && <p role="status">{mail}</p>}</details>}
        </div>
        <aside className="card stack side">
          {v.status === 'CONFIRMED' && <Notice kind="good">Already paid {money(v.paid)}. There is nothing to collect.</Notice>}
          {settle && <>
            {v.paid > 0 && <div className="total small"><span>Already paid</span><b className="num">{money(v.paid)}</b></div>}
            <div className="due"><span>{due < 0 ? 'Give back' : 'To pay'}</span><b className="num">{money(Math.abs(due))}</b></div>
            {due !== 0 && <fieldset className="methods"><legend>{due < 0 ? 'Refunded by' : 'Paid by'}</legend>
              {PAY_METHODS.map(m => <label key={m}><input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />{m}</label>)}</fieldset>}
            {due > 0 && method === 'Cash' && <>
              <Field label="Cash received"><input ref={cashRef} data-field="cash" value={tendered} onChange={e => setTendered(e.target.value)} inputMode="decimal" autoComplete="off" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (ready) document.getElementById('pay')?.focus(); } }} /></Field>
              <div className="total"><span>Change</span><b className="num">{got !== null && got >= due ? money(got - due) : '–'}</b></div>
            </>}
            {error && <Notice kind="bad">{error}</Notice>}
            <button id="pay" className="btn big" onClick={pay} disabled={busy || !ready}>{busy ? 'Saving…' : due > 0 ? `Take ${money(due)}` : due < 0 ? `Refund ${money(-due)}` : 'Confirm'}</button>
          </>}
        </aside>
      </div>}
    </>
  );
}
