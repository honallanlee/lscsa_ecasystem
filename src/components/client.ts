'use client';
import type { Routes } from '../lib/service.ts';

export class ApiError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
/** Dates arrive as text over the network. */
type Wire<T> = T extends Date ? string : T extends (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
export type Data<K extends keyof Routes> = Wire<Routes[K]>;

async function post(path: string, payload: object): Promise<unknown> {
  let body: { ok: boolean; data?: unknown; code?: string; message?: string };
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    body = await res.json();
  } catch { throw new ApiError('OFFLINE', 'No connection. Press the button again when you are back online; it will not save twice.'); }
  if (!body.ok) {
    if (body.code === 'SIGNIN') location.href = '/login';
    throw new ApiError(body.code ?? 'ERROR', body.message ?? 'Something went wrong.');
  }
  return body.data;
}
export const call = <K extends keyof Routes>(name: K, payload: object = {}) => post('/api/' + name, payload) as Promise<Data<K>>;
export const auth = (what: 'login' | 'logout' | 'setup', payload: object = {}) => post('/api/auth/' + what, payload);
export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
export const when = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
export function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
