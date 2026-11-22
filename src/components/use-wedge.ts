'use client';
import { useEffect, useRef } from 'react';
import { WEDGE, couldBeScan, createWedge } from '../lib/wedge.ts';

export type WedgeScan = { text: string; field: string; before: string };
type TextBox = HTMLInputElement | HTMLTextAreaElement;
const isTextBox = (el: EventTarget | null): el is TextBox => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['radio', 'checkbox', 'file', 'button', 'submit'].includes(el.type));

/**
 * Listens for a handheld scanner anywhere on the page. The scan is handed over once, whatever was focused,
 * and its Enter or Tab never presses a button. Scans made while one is still being handled wait their turn.
 * `accepts` says whether a scan with no Enter or Tab is complete.
 */
export function useWedge(onScan: (s: WedgeScan) => Promise<void> | void, accepts: (text: string) => boolean) {
  const handler = useRef(onScan), ok = useRef(accepts);
  handler.current = onScan; ok.current = accepts;

  useEffect(() => {
    const wedge = createWedge();
    let queue: Promise<void> = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined;
    let box: TextBox | null = null, before = '';
    const deliver = (text: string) => {
      const scan = { text, field: box?.dataset.field ?? '', before };
      queue = queue.then(() => handler.current(scan)).catch(e => console.error('scan', e))
        .then(() => new Promise(r => setTimeout(r, 30))); // let the screen update before the next scan
    };
    function onKey(e: KeyboardEvent) {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) { wedge.reset(); return; }
      const target = isTextBox(e.target) ? e.target : null;
      if (target && !target.dataset.field) return; // boxes that are never scanned into
      const r = wedge.key(e.key, e.timeStamp, Boolean(target));
      if (r.start) { box = target; before = target?.value ?? ''; }
      clearTimeout(timer);
      if (r.scan !== undefined && couldBeScan(r.scan, box?.dataset.field ?? '')) {
        e.preventDefault(); e.stopImmediatePropagation();
        deliver(r.scan);
        return;
      }
      if (e.key.length === 1) timer = setTimeout(() => {
        const t = wedge.idle(e.timeStamp + WEDGE.quiet + 1);
        if (t && couldBeScan(t, box?.dataset.field ?? '') && ok.current(t)) deliver(t);
      }, WEDGE.quiet + 10);
    }
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); clearTimeout(timer); };
  }, []);
}

/** Moves to a field and selects what is in it, so the next scan replaces it. */
export function go(el: HTMLElement | null | undefined) {
  el?.focus();
  if (el instanceof HTMLInputElement) el.select();
}
