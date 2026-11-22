'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from './app-context.tsx';
import { call, errorText, type Data } from './client.ts';
import { Field, Notice } from './ui.tsx';

type Codes = Map<string, { bar: string; qr: string }>;
/** Each item gets a QR code for phones and a Code 128 barcode for handheld scanners. Both hold the same text. */
async function draw(values: string[]): Promise<Codes> {
  const { prepareZXingModule, writeBarcode } = await import('zxing-wasm/writer');
  prepareZXingModule({ overrides: { locateFile: (f: string) => '/wasm/' + f } });
  const one = async (v: string, format: 'Code128' | 'QRCode') => {
    const r = await writeBarcode(v, { format });
    if (r.error || !r.svg) throw new Error(`Could not make a code for ${v}.`);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
  };
  const out: Codes = new Map();
  for (const v of values) out.set(v, { bar: await one(v, 'Code128'), qr: await one(v, 'QRCode') });
  return out;
}

export function Print() {
  const { clubs, rules, fairName } = useApp();
  const [what, setWhat] = useState<'clubs' | 'slips'>('slips'), [classes, setClasses] = useState<string[]>([]), [cls, setCls] = useState('');
  const [students, setStudents] = useState<Data<'printList'>['students']>([]), [codes, setCodes] = useState<Codes | null>(null), [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    setCodes(null); setError('');
    (async () => {
      try {
        let list: typeof students = [];
        if (what === 'slips') {
          const r = await call('printList', { cls });
          if (stale) return;
          setClasses(r.classes); list = r.students; setStudents(list);
        }
        const c = await draw(what === 'slips' ? list.map(s => s.regNo) : clubs.map(x => x.code));
        if (!stale) setCodes(c);
      } catch (e) { if (!stale) setError(errorText(e)); }
    })();
    return () => { stale = true; };
  }, [what, cls, clubs]);

  const count = what === 'slips' ? students.length : clubs.length;
  return (
    <>
      <div className="noprint stack">
        <h1>Print codes</h1>
        <p className="muted"><Link href="/app/admin">Back to Admin</Link></p>
        <div className="row wrap">
          <Field label="Print"><select value={what} onChange={e => setWhat(e.target.value as typeof what)}><option value="slips">Student slips</option><option value="clubs">Club labels</option></select></Field>
          {what === 'slips' && <Field label="Class"><select value={cls} onChange={e => setCls(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c}>{c}</option>)}</select></Field>}
        </div>
        {error && <Notice kind="bad">{error}</Notice>}
        {count > 0 && <div className="row"><button className="btn" disabled={!codes} onClick={() => print()}>{codes ? `Print ${count}` : 'Making codes…'}</button><span className="muted">{what === 'slips' ? 'A4 landscape, three to a page.' : 'A4 portrait.'} Set scale to 100%.</span></div>}
      </div>
      {what === 'slips' && <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>}
      {codes && what === 'slips' && <div className="slips">{students.map(s => {
        const c = codes.get(s.regNo);
        return c && <article key={s.regNo} className="slip">
          <header><b>{fairName}</b></header>
          <p className="name">{s.name} <span lang="zh-Hant">{s.nameAlt}</span></p><p>{s.cls} ({s.classNo})</p>
          <div className="codes"><img src={c.qr} alt="" /><div><img className="bar" src={c.bar} alt="" /><b>{s.regNo}</b></div></div>
          <p className="line">Tel</p>
          {Array.from({ length: rules.find(r => r.level === s.level)?.max || 4 }, (_, i) => <p key={i} className="line">{i + 1}</p>)}
        </article>;
      })}</div>}
      {codes && what === 'clubs' && <div className="labels">{clubs.map(x => {
        const c = codes.get(x.code);
        return c && <article key={x.code} className="label"><img src={c.qr} alt="" /><div><b>{x.name}</b><span>{x.category}</span><img className="bar" src={c.bar} alt="" /><b>{x.code}</b></div></article>;
      })}</div>}
    </>
  );
}
