import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEDGE, couldBeScan, createWedge } from '../src/lib/wedge.ts';

/** Types each letter `gap` ms apart, then the ending key. */
function type(w: ReturnType<typeof createWedge>, text: string, gap: number, end: string | null, { at = 0, inField = true, endGap = gap } = {}) {
  let t = at;
  for (const ch of text) { w.key(ch, t, inField); t += gap; }
  return end === null ? undefined : w.key(end, t - gap + endGap, inField).scan;
}

test('scanners ending in Enter or Tab, fast or slow', () => {
  for (const end of ['Enter', 'Tab']) for (const gap of [1, 5, 20, 45]) assert.equal(type(createWedge(), 's90001', gap, end), 's90001');
  assert.equal(type(createWedge(), 'C04', 10, 'Enter'), 'C04');
});
test('capital letters sent with Shift', () => {
  const w = createWedge();
  let t = 0;
  for (const ch of 'S18') { w.key('Shift', t, true); w.key(ch, t + 1, true); t += 8; }
  assert.equal(w.key('Enter', t, true).scan, 'S18');
});
test('scanners that send no ending', () => {
  const w = createWedge();
  type(w, 's90001', 10, null);
  assert.equal(w.idle(100), undefined, 'too soon');
  assert.equal(w.idle(50 + WEDGE.quiet), 's90001');
  assert.equal(w.idle(5000), undefined, 'handed over once');
});
test('people typing are left alone', () => {
  for (const gap of [80, 120, 250]) assert.equal(type(createWedge(), 'c04', gap, 'Enter'), undefined);
  const w = createWedge();
  type(w, '90001', 90, null);
  assert.equal(w.idle(9000), undefined);
  assert.equal(type(createWedge(), 'c04', 10, 'Enter', { endGap: 400 }), undefined, 'Enter pressed later by hand');
  assert.equal(type(createWedge(), 'ab', 5, 'Enter'), undefined);
});
test('a fast scan straight after slow typing contains only the scan', () => {
  const w = createWedge();
  type(w, '612', 120, null);
  assert.equal(type(w, 'C04', 10, 'Enter', { at: 1000 }), 'C04');
});
test('outside a text box a slower scanner is still recognised', () => {
  assert.equal(type(createWedge(), 's90001', 110, 'Enter', { inField: false }), 's90001');
});
test('editing keys cancel', () => {
  const w = createWedge();
  type(w, 's900', 10, null); w.key('Backspace', 45, true);
  assert.equal(w.key('Enter', 50, true).scan, undefined);
});
test('phone numbers, cash and notes typed quickly are not scans', () => {
  assert.equal(couldBeScan('61234567', 'phone'), false); assert.equal(couldBeScan('500', 'cash'), false);
  assert.equal(couldBeScan('C04', 'phone'), true); assert.equal(couldBeScan('s90001', 'cash'), true);
  assert.equal(couldBeScan('hello', 'note'), false); assert.equal(couldBeScan('S90001', 'note'), true);
  assert.equal(couldBeScan('90001', 'reg'), true);
});
