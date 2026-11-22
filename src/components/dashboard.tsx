'use client';
import { useState } from 'react';
import { CATEGORIES, PAY_METHODS, atLeast, money } from '../lib/rules.ts';
import { useApp } from './app-context.tsx';
import { call, errorText } from './client.ts';
import { Field, Notice, useLoad, useRequestId } from './ui.tsx';

export function Dashboard() {
  const { me } = useApp(), { data: d, error } = useLoad(() => call('dashboard'), 20_000);
  const [cat, setCat] = useState('');
  if (!d) return <><h1>Dashboard</h1>{error ? <Notice kind="bad">{error}</Notice> : <p className="muted">Loading…</p>}</>;
  const sum = (k: 'total' | 'registered' | 'confirmed') => d.levels.reduce((t, l) => t + l[k], 0);
  const clubs = d.clubs.filter(c => !cat || c.category === cat), top = Math.max(1, ...d.clubs.map(c => c.signups));
  return (
    <>
      <h1>Dashboard</h1>
      {error && <Notice kind="warn">Could not refresh: {error}</Notice>}
      <dl className="figures">
        <div><dt>Confirmed</dt><dd className="num">{sum('confirmed')}<small> of {sum('total')} students</small></dd></div>
        <div><dt>Collected</dt><dd className="num">{money(d.collected)}</dd></div>
        <div><dt>Waiting for cashier</dt><dd className="num">{d.owing}<small> {d.owing > 0 && `${money(d.due)} outstanding`}</small></dd></div>
      </dl>
      <h2>By form</h2>
      <table className="bars"><thead><tr><th>Form</th><th className="hide">Progress</th><th className="num">Confirmed</th><th className="num">Registered</th><th className="num">Students</th></tr></thead>
        <tbody>{d.levels.map(l => <tr key={l.level}><td>{l.level}</td><td className="barcell hide"><span className="bar" aria-hidden><i style={{ width: `${(l.registered / l.total) * 100}%` }} className="pale" /><i style={{ width: `${(l.confirmed / l.total) * 100}%` }} /></span></td><td className="num">{l.confirmed}</td><td className="num">{l.registered}</td><td className="num">{l.total}</td></tr>)}</tbody></table>
      {atLeast(me.role, 'cashier') && <CashUp />}
      <div className="row between"><h2>Clubs</h2><label className="row">Category <select value={cat} onChange={e => setCat(e.target.value)}><option value="">All</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label></div>
      <table className="bars"><thead><tr><th>Club</th><th className="hide">Category</th><th>Sign-ups</th><th className="num">Confirmed</th><th className="num">To pay club</th></tr></thead>
        <tbody>{clubs.map(c => <tr key={c.code}><td>{c.name}</td><td className="hide">{c.category}</td><td className="barcell"><span className="bar" aria-hidden><i className="pale" style={{ width: `${(c.signups / top) * 100}%` }} /></span><span className="num">{c.signups}</span></td><td className="num">{c.confirmed}</td><td className="num">{money(c.payout)}</td></tr>)}</tbody>
        <tfoot><tr><th>Total</th><th className="hide" /><th className="num">{clubs.reduce((t, c) => t + c.signups, 0)}</th><th className="num">{clubs.reduce((t, c) => t + c.confirmed, 0)}</th><th className="num">{money(clubs.reduce((t, c) => t + c.payout, 0))}</th></tr></tfoot></table>
    </>
  );
}

function CashUp() {
  const { data, error, reload } = useLoad(() => call('cash'), 20_000), req = useRequestId();
  const [method, setMethod] = useState('Cash'), [counted, setCounted] = useState(''), [remark, setRemark] = useState(''), [msg, setMsg] = useState<{ kind: 'good' | 'bad' | 'warn'; text: string } | null>(null), [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await call('cashup', { requestId: req.get(), method, counted, remark });
      req.done(); setCounted(''); setRemark('');
      setMsg(r.difference === 0 ? { kind: 'good', text: 'Balanced.' } : { kind: 'warn', text: `${money(Math.abs(r.difference))} ${r.difference > 0 ? 'over' : 'short'}.` });
      await reload();
    } catch (e) { setMsg({ kind: 'bad', text: errorText(e) }); } finally { setBusy(false); }
  }
  return (
    <section>
      <h2>Today&rsquo;s takings</h2>
      {error && <Notice kind="bad">{error}</Notice>}
      {data && <div className="two even">
        <div className="stack">
          <table><thead><tr><th>Method</th><th className="num">Payments</th><th className="num">Total</th></tr></thead><tbody>{data.methods.map(m => <tr key={m.method}><td>{m.method}</td><td className="num">{m.count}</td><td className="num">{money(m.total)}</td></tr>)}</tbody></table>
          {data.cashiers.length > 0 && <table><thead><tr><th>Cashier</th><th className="num">Students</th><th className="num">Total</th></tr></thead><tbody>{data.cashiers.map(c => <tr key={c.name}><td>{c.name}</td><td className="num">{c.count}</td><td className="num">{money(c.total)}</td></tr>)}</tbody></table>}
        </div>
        <form className="card stack" onSubmit={e => { e.preventDefault(); if (!busy) void save(); }}>
          <h3>Balance the box</h3>
          <div className="row"><Field label="Method"><select value={method} onChange={e => setMethod(e.target.value)}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field><Field label="Amount counted"><input value={counted} onChange={e => setCounted(e.target.value)} inputMode="decimal" required /></Field></div>
          <Field label="Remark (optional)"><input value={remark} onChange={e => setRemark(e.target.value)} maxLength={300} /></Field>
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <button className="btn" disabled={busy}>Record count</button>
          {data.counts.map(c => <p key={c.id} className="muted">{c.method}: counted {money(c.counted)}, expected {money(c.expected)} ({c.by}){c.remark && `. ${c.remark}`}</p>)}
        </form>
      </div>}
    </section>
  );
}
