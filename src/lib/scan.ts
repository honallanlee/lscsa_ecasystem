// Deciding what a scanned code means, and when to believe the camera. No browser code, so it is fully tested.
import { normCode, normReg } from './rules.ts';

export type Scanned = { kind: 'club'; code: string } | { kind: 'student'; regNo: string } | { kind: 'unknown'; text: string };

/** Code 39 barcodes are sometimes read with their * start and stop marks. */
export function classify(text: string, clubCodes: ReadonlySet<string>): Scanned {
  const clean = text.trim().replace(/^\*+|\*+$/g, '');
  const code = normCode(clean);
  if (clubCodes.has(code)) return { kind: 'club', code };
  const regNo = normReg(clean);
  return regNo ? { kind: 'student', regNo } : { kind: 'unknown', text: clean.slice(0, 40) };
}

/**
 * Filters raw camera reads. A value counts once it has been seen twice in quick succession
 * (Code 39 has no check digit, so one blurred read can be wrong), and then not again
 * until it has been out of view for a moment.
 */
export function createGate({ within = 900, rearm = 1200 } = {}) {
  let candidate = '', candidateAt = -Infinity;
  const seen = new Map<string, number>();
  return {
    push(value: string, now: number): boolean {
      for (const [v, at] of seen) if (now - at > rearm) seen.delete(v);
      if (seen.has(value)) { seen.set(value, now); return false; }
      const again = value === candidate && now - candidateAt <= within;
      candidate = value; candidateAt = now;
      if (!again) return false;
      seen.set(value, now);
      candidate = '';
      return true;
    },
    /** Lets a value count again straight away, for when it could not be handled yet. */
    release(value: string) { seen.delete(value); }
  };
}

/** Puts a scanned club into the first empty slot. */
export function addClub(codes: string[], code: string, max: number): { codes: string[]; result: 'added' | 'already' | 'full' } {
  if (codes.some(c => normCode(c) === code)) return { codes, result: 'already' };
  const i = codes.findIndex(c => !c.trim());
  if (i < 0 && codes.length >= max) return { codes, result: 'full' };
  return { codes: i < 0 ? [...codes, code] : codes.map((c, j) => (j === i ? code : c)), result: 'added' };
}
