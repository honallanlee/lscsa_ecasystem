// Recognising a handheld barcode scanner. It acts as a keyboard that types far faster than a person,
// usually ending with Enter or Tab, sometimes with nothing. No browser code, so it is fully tested.

export const WEDGE = {
  inField: 60,   // longest gap between a scanner's letters, in milliseconds; people are slower
  outside: 150,  // more patient when no text box is selected, where nobody types on purpose
  suffix: 150,   // Enter or Tab must follow this soon to be part of the scan
  quiet: 300,    // with no Enter or Tab, the scan is over after this much silence
  shortest: 3
};

export function createWedge() {
  let text = '', last = -Infinity;
  const take = () => { const t = text; text = ''; return t; };
  return {
    /** `start` marks the first letter of a possible scan; `scan` is a finished one. */
    key(key: string, now: number, inField: boolean): { start?: true; scan?: string } {
      if (key === 'Enter' || key === 'Tab') {
        const t = take();
        return t.length >= WEDGE.shortest && now - last <= WEDGE.suffix ? { scan: t } : {};
      }
      if (key === 'Shift' || key === 'CapsLock') return {};
      if (key.length !== 1) { take(); return {}; }
      if (now - last > (inField ? WEDGE.inField : WEDGE.outside)) take();
      const start = text === '';
      text += key; last = now;
      return start ? { start } : {};
    },
    /** For scanners that send no Enter or Tab. */
    idle(now: number): string | undefined {
      if (text.length < WEDGE.shortest || now - last < WEDGE.quiet) return undefined;
      return take();
    },
    reset() { take(); }
  };
}

/** A phone number or an amount typed quickly is never a scan; slips and labels there always contain a letter. Notes only give way to a slip. */
export function couldBeScan(text: string, field: string): boolean {
  if (field === 'phone' || field === 'cash') return /[a-z]/i.test(text);
  return field !== 'note' || /^\*?s\d{4,6}\*?$/i.test(text);
}
