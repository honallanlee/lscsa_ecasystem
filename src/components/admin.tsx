'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ROLES } from '../lib/rules.ts';
import { call, download, errorText, type Data } from './client.ts';
import { Field, Notice, useLoad } from './ui.tsx';

type Msg = { kind: 'good' | 'bad'; text: string } | null;
function useAct(after?: () => unknown) {
  const [msg, setMsg] = useState<Msg>(null), [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<string>) => {
    if (busy) return false;
    setBusy(true); setMsg(null);
    try { setMsg({ kind: 'good', text: await fn() }); await after?.(); return true; }
    catch (e) { setMsg({ kind: 'bad', text: errorText(e) }); return false; } finally { setBusy(false); }
  };
  return { act, busy, note: msg && <Notice kind={msg.kind}>{msg.text}</Notice> };
}
const values = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)); };

export function Admin() {
  const { data, error, reload } = useLoad(() => call('adminInfo'));
  if (!data) return <><h1>Admin</h1>{error ? <Notice kind="bad">{error}</Notice> : <p className="muted">Loading…</p>}</>;
  return (
    <>
      <h1>Admin</h1>
      <Lists counts={data.counts} reload={reload} />
      <Exports />
      <Staff staff={data.staff} reload={reload} />
      <Settings s={data.settings} email={data.email} reload={reload} />
      <div className="two even"><Password /><NewFair fairs={data.fairs} reload={reload} /></div>
    </>
  );
}

function Lists({ counts, reload }: { counts: Data<'adminInfo'>['counts']; reload: () => unknown }) {
  const [kind, setKind] = useState<'students' | 'clubs' | 'rules'>('students'), [csv, setCsv] = useState(''), [file, setFile] = useState(''), [preview, setPreview] = useState<Data<'importPreview'> | null>(null);
  const { act, busy, note } = useAct(reload);
  async function pick(f: File | undefined) {
    setPreview(null); setCsv('');
    if (!f) return;
    const text = await f.text();
    setFile(f.name); setCsv(text);
    await act(async () => { const p = await call('importPreview', { kind, csv: text }); setPreview(p); return p.errorCount ? `${p.errorCount} problem(s) found. Nothing has been changed.` : `${p.count} rows look right. Nothing has been changed yet.`; });
  }
  return (
    <section><h2>Lists</h2>
      <p className="muted">Now: {counts.students} students, {counts.clubs} clubs, {counts.rules} form rules. Registrations and payments are never touched by an import.</p>
      <div className="card stack">
        <div className="row"><Field label="Replace"><select value={kind} onChange={e => { setKind(e.target.value as typeof kind); setPreview(null); setCsv(''); setFile(''); }}><option value="students">Students</option><option value="clubs">Clubs</option><option value="rules">Form rules</option></select></Field>
          <Field label="CSV file"><input key={kind + file} type="file" accept=".csv,text/csv" onChange={e => pick(e.target.files?.[0])} /></Field></div>
        {note}
        {preview && <>
          {preview.errors.length > 0 && <ul className="plain">{preview.errors.map(x => <li key={x}>{x}</li>)}</ul>}
          {preview.warnings.map(x => <Notice key={x} kind="warn">{x}</Notice>)}
          {!preview.errorCount && preview.sample[0] && <div className="scroll"><table><thead><tr>{Object.keys(preview.sample[0]).map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>{preview.sample.map((r, i) => <tr key={i}>{Object.entries(r).map(([k, x]) => <td key={k}>{k === 'fee' ? (Number(x) / 100).toFixed(2) : x}</td>)}</tr>)}</tbody></table></div>}
          {!preview.errorCount && <button className="btn" disabled={busy} onClick={() => act(async () => { const r = await call('importCommit', { kind, csv }); setPreview(null); setCsv(''); setFile(''); return `Imported ${r.count} rows.`; })}>Import {preview.count} rows from {file}</button>}
        </>}
      </div>
    </section>
  );
}

function Exports() {
  const { act, busy, note } = useAct(), [only, setOnly] = useState(false);
  const get = (kind: string) => act(async () => { const r = await call('exportCsv', { kind, confirmedOnly: only }); download(r.filename, r.csv); return `Downloaded ${r.count} rows.`; });
  return (
    <section><h2>Exports and printing</h2>
      <div className="row wrap"><button className="btn" disabled={busy} onClick={() => get('school')}>School file</button>
        {[['absent', 'Not registered'], ['owing', 'Not paid'], ['payments', 'Payments'], ['audit', 'Activity log']].map(([k, l]) => <button key={k} className="btn quiet" disabled={busy} onClick={() => get(k!)}>{l}</button>)}<Link className="btn quiet" href="/app/print">Print slips and labels</Link></div>
      <label className="row"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> School file: paid students only</label>{note}
    </section>
  );
}

function Staff({ staff, reload }: { staff: Data<'adminInfo'>['staff']; reload: () => unknown }) {
  const [edit, setEdit] = useState<Data<'adminInfo'>['staff'][number] | 'new' | null>(null), { act, busy, note } = useAct(reload);
  const p = edit === 'new' ? null : edit;
  return (
    <section><div className="row between"><h2>Staff</h2><button className="btn quiet" onClick={() => setEdit('new')}>Add person</button></div>
      <table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th /></tr></thead><tbody>{staff.map(s => <tr key={s.id} className={s.active ? '' : 'off'}><td>{s.name}</td><td>{s.username}</td><td>{s.active ? s.role : 'switched off'}</td><td className="num"><button className="link" onClick={() => setEdit(s)}>Edit</button></td></tr>)}</tbody></table>
      {edit && <form key={p?.id ?? 'new'} className="card stack" onSubmit={async e => { const v = values(e); if (await act(async () => { await call('saveStaff', { ...v, id: p?.id, active: p ? v.active === 'on' : true }); return 'Saved.'; })) setEdit(null); }}>
        <div className="row wrap"><Field label="Name"><input name="name" defaultValue={p?.name} required maxLength={80} /></Field><Field label="Username"><input name="username" defaultValue={p?.username} required autoCapitalize="none" autoComplete="off" /></Field>
          <Field label="Role"><select name="role" defaultValue={p?.role ?? 'helper'}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label={p ? 'New password (optional)' : 'Password'}><input name="password" type="password" minLength={10} required={!p} autoComplete="new-password" /></Field></div>
        {p && <label className="row"><input name="active" type="checkbox" defaultChecked={p.active} /> Can sign in</label>}
        <div className="row"><button className="btn" disabled={busy}>Save</button><button type="button" className="btn quiet" onClick={() => setEdit(null)}>Cancel</button></div>
      </form>}{note}
    </section>
  );
}

function Settings({ s, email, reload }: { s: Data<'adminInfo'>['settings']; email: Data<'adminInfo'>['email']; reload: () => unknown }) {
  const { act, busy, note } = useAct(reload);
  return (
    <section><h2>Fair details</h2>
      <form className="card stack" onSubmit={e => { const v = values(e); void act(async () => { await call('saveSettings', v); return 'Saved.'; }); }}>
        <div className="row wrap"><Field label="Fair name"><input name="name" defaultValue={s.name} required maxLength={100} /></Field><Field label="Student email domain" hint="Used when the student file has no email column."><input name="emailDomain" defaultValue={s.emailDomain} placeholder="example.com" /></Field></div>
        <div className="row wrap"><Field label="Contact name"><input name="contactName" defaultValue={s.contactName} /></Field><Field label="Contact phone"><input name="contactPhone" defaultValue={s.contactPhone} /></Field><Field label="Contact email"><input name="contactEmail" type="email" defaultValue={s.contactEmail} /></Field></div>
        <p className="muted">{email.ready ? `Email: ${email.used} of ${email.cap} used this month.` : 'Email is switched off. Add the Resend keys in Vercel to turn it on.'}</p>
        {note}<div><button className="btn" disabled={busy}>Save details</button></div>
      </form>
    </section>
  );
}

function Password() {
  const { act, busy, note } = useAct();
  return <section><h2>Your password</h2><form className="card stack" onSubmit={async e => { const f = e.currentTarget, v = values(e); if (await act(async () => { await call('changePassword', v); return 'Password changed.'; })) f.reset(); }}>
    <Field label="Current password"><input name="current" type="password" required autoComplete="current-password" /></Field><Field label="New password" hint="At least 10 characters."><input name="next" type="password" minLength={10} required autoComplete="new-password" /></Field>{note}<div><button className="btn" disabled={busy}>Change password</button></div></form></section>;
}

function NewFair({ fairs, reload }: { fairs: Data<'adminInfo'>['fairs']; reload: () => unknown }) {
  const { act, busy, note } = useAct(reload);
  return <section><h2>Start a new fair</h2><form className="card stack" onSubmit={async e => { const f = e.currentTarget, v = values(e); if (confirm(`Start "${String(v.name)}"? The current fair is kept but becomes read-only.`) && await act(async () => { await call('newFair', { name: v.name, copy: v.copy === 'on' }); return 'New fair started.'; })) { f.reset(); location.reload(); } }}>
    <Field label="Name"><input name="name" required maxLength={100} placeholder="ECA Promotion Fair 2027" /></Field><label className="row"><input name="copy" type="checkbox" defaultChecked /> Copy clubs and rules</label><p className="muted">Kept fairs: {fairs.map(f => f.name + (f.isCurrent ? ' (current)' : '')).join(', ')}</p>{note}<div><button className="btn quiet" disabled={busy}>Start new fair</button></div></form></section>;
}
