// Business rules with no database or browser code, shared by the server and the screens.
export const CATEGORIES = ['Academic', 'Cultural', 'Interest', 'Service', 'Sports'] as const;
export type Category = (typeof CATEGORIES)[number];
export const PAY_METHODS = ['Cash', 'FPS', 'Other'] as const;
export const ROLES = ['helper', 'cashier', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const MAX_CHOICES = 8;

export type Club = { code: string; name: string; category: Category; fee: number };
export type Rule = { level: string; min: number; max: number } & Record<Category, number>;

export const atLeast = (role: Role, need: Role) => ROLES.indexOf(role) >= ROLES.indexOf(need);

/** "S12345", "12345" and " s12345 " all mean "s12345". Anything else gives "". */
export function normReg(v: unknown): string {
  const m = /^s?(\d{4,6})$/.exec(String(v ?? '').trim().toLowerCase());
  return m ? 's' + m[1] : '';
}
export const normCode = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** "$7.50 " becomes 750 cents. Returns null for anything that is not a plain amount. */
export function parseCents(v: unknown): number | null {
  const s = String(v ?? '').trim().replace(/^HK/i, '').replace(/^\$/, '').replace(/,/g, '').trim();
  return /^\d{1,7}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null;
}
export function money(cents: number): string {
  const a = Math.abs(cents);
  return (cents < 0 ? '−' : '') + 'HK$' + (a % 100 ? (a / 100).toFixed(2) : String(a / 100));
}

/** Checks chosen club codes against a form level's rule. `errors` is empty when the choice is allowed. */
export function checkChoices(codes: unknown[], clubs: Club[], rule: Rule | undefined) {
  const byCode = new Map(clubs.map(c => [c.code, c]));
  const errors: string[] = [], chosen: Club[] = [], seen = new Set<string>();
  const counts = Object.fromEntries(CATEGORIES.map(k => [k, 0])) as Record<Category, number>;
  for (const code of codes.map(normCode).filter(Boolean)) {
    if (seen.has(code)) { errors.push(`Club ${code} is entered twice.`); continue; }
    seen.add(code);
    const c = byCode.get(code);
    if (!c) { errors.push(`Club ${code} does not exist.`); continue; }
    chosen.push(c); counts[c.category]++;
  }
  if (!rule) errors.push('No rule is set for this form level.');
  else {
    for (const k of CATEGORIES) if (counts[k] < rule[k]) errors.push(`Needs ${rule[k]} ${k} (has ${counts[k]}).`);
    if (chosen.length < rule.min) errors.push(`Needs at least ${rule.min} clubs (has ${chosen.length}).`);
    if (chosen.length > rule.max) errors.push(`At most ${rule.max} clubs allowed (has ${chosen.length}).`);
  }
  return { clubs: chosen, counts, errors, total: chosen.reduce((t, c) => t + c.fee, 0) };
}

/** Greeting name: "CHAN Tai Man" gives "Tai Man"; single names are kept. */
export function givenName(full: string): string {
  const w = full.trim().split(/\s+/);
  return (w.length > 1 ? w.slice(1) : w).map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join(' ');
}
