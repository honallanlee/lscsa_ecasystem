import { money, givenName } from './rules.ts';

export type Receipt = {
  fairName: string; regNo: string; name: string; cls: string; classNo: string; phone: string; at: Date; version: number;
  total: number; amount: number; clubs: { name: string; category: string; fee: number }[];
  contact: { name: string; phone: string; email: string };
};
export type Message = { to: string; subject: string; text: string; html: string; replyTo?: string };
export type Sender = (m: Message, idempotencyKey: string) => Promise<void>;

export const NOTICE = 'Independent project. Not an official school service.';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function buildEmail(r: Receipt, to: string): Message {
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(r.at);
  const info = [['Full name', r.name], ['Class', `${r.cls} (${r.classNo})`], ['Phone number', r.phone], ['Confirmed', when],
    ['Clubs', String(r.clubs.length)], ['Total fee', money(r.total)], [r.amount < 0 ? 'Refunded this visit' : 'Paid this visit', money(Math.abs(r.amount))]];
  const contact = [r.contact.name, r.contact.phone, r.contact.email].filter(Boolean);
  const intro = `This is your ${r.fairName} registration confirmation.` + (r.version > 1 ? ' It replaces any earlier confirmation.' : '');
  const text = [`Dear ${givenName(r.name)},`, '', intro, '', ...info.map(([k, v]) => `${k}: ${v}`), '', 'Your clubs:',
    ...(r.clubs.length ? r.clubs.map(c => `- ${c.name} (${c.category}) ${money(c.fee)}`) : ['- No clubs']),
    ...(contact.length ? ['', 'Questions or changes: ' + contact.join(', ')] : []), '', NOTICE].join('\n');
  const td = 'padding:8px 0;border-bottom:1px solid #eadfe8';
  const html = `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;color:#2a1a28;font-size:15px;line-height:1.5">
<div style="background:#7d0a68;color:#fff;padding:24px;font-size:20px;font-weight:bold">${esc(r.fairName)}</div><div style="padding:24px 4px">
<p>Dear ${esc(givenName(r.name))},</p><p>${esc(intro)}</p><table style="width:100%;border-collapse:collapse">${info.map(([k, v]) => `<tr><td style="${td};color:#6b5868">${esc(k)}</td><td style="${td};text-align:right">${esc(v)}</td></tr>`).join('')}</table>
<h3 style="margin:28px 0 8px">Your clubs</h3><table style="width:100%;border-collapse:collapse">${r.clubs.length ? r.clubs.map(c => `<tr><td style="${td}">${esc(c.name)}</td><td style="${td}">${esc(c.category)}</td><td style="${td};text-align:right">${money(c.fee)}</td></tr>`).join('') : `<tr><td style="${td}">No clubs</td></tr>`}</table>
${contact.length ? `<p style="margin-top:24px">Questions or changes:<br>${contact.map(esc).join('<br>')}</p>` : ''}<p style="color:#6b5868;font-size:12px">${NOTICE}</p></div></div>`;
  return { to, subject: `${r.fairName} confirmation - ${r.regNo}`, text, html, ...(r.contact.email ? { replyTo: r.contact.email } : {}) };
}

export const emailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
export const emailCap = () => Math.max(0, Number(process.env.EMAIL_MONTHLY_CAP || 20) || 0);

export const resendSender: Sender = async (m, key) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(m.replyTo ? { reply_to: m.replyTo } : {}) })
  });
  if (!res.ok) throw new Error(`Email service said ${res.status}: ${(await res.text()).slice(0, 200)}`);
};
