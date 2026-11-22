import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkChoices, givenName, money, normReg, parseCents, type Club, type Rule } from '../src/lib/rules.ts';
import { csvCell, parseCsv } from '../src/lib/csv.ts';

const clubs: Club[] = [{ code: 'A01', name: 'A', category: 'Academic', fee: 750 }, { code: 'C01', name: 'C', category: 'Cultural', fee: 0 },
  { code: 'U01', name: 'U', category: 'Service', fee: 500 }, { code: 'S01', name: 'S', category: 'Sports', fee: 1000 }, { code: 'S02', name: 'S2', category: 'Sports', fee: 0 }];
const s1: Rule = { level: 'S1', Academic: 0, Cultural: 1, Interest: 0, Service: 1, Sports: 1, min: 3, max: 4 };

test('registration numbers', () => {
  assert.equal(normReg(' S12345 '), 's12345'); assert.equal(normReg('12345'), 's12345');
  for (const v of ['', null, 's12', "s1'--", 'x12345']) assert.equal(normReg(v), '');
});
test('money keeps cents (old bug: $7.50 became $7)', () => {
  assert.equal(parseCents('$7.50 '), 750); assert.equal(parseCents('$0.00 '), 0); assert.equal(parseCents('1,000'), 100000);
  for (const v of ['', 'abc', '-5', '1.234', 'N.A.', '1e5']) assert.equal(parseCents(v), null);
  assert.equal(money(750), 'HK$7.50'); assert.equal(money(-500), '−HK$5');
});
test('rules: valid, missing category, too few, too many', () => {
  assert.deepEqual(checkChoices(['C01', 'U01', 'S01'], clubs, s1).errors, []);
  assert.equal(checkChoices(['A01', 'C01', 'U01', 'S01'], clubs, s1).total, 2250);
  assert.equal(checkChoices(['A01', 'C01', 'S01'], clubs, s1).errors.length, 1);
  assert.equal(checkChoices(['C01', 'U01'], clubs, s1).errors.length, 2);
  assert.match(checkChoices(['A01', 'C01', 'U01', 'S01', 'S02'], clubs, s1).errors.join(), /At most 4/);
  assert.equal(checkChoices([], clubs, undefined).errors.length, 1);
});
test('duplicates are caught whatever the case (old bug: a01 + A01 passed)', () => {
  assert.match(checkChoices(['a01', 'A01'], clubs, s1).errors.join(), /entered twice/);
});
test('csv parsing and formula protection', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, ""y""",2\n,,\n'), [['a', 'b'], ['x, "y"', '2']]);
  assert.equal(csvCell('=HYPERLINK(1)'), "'=HYPERLINK(1)"); assert.equal(csvCell('-5'), '-5'); assert.equal(csvCell('a,b'), '"a,b"');
});
test('greeting', () => { assert.equal(givenName('CHAN TAI MAN'), 'Tai Man'); assert.equal(givenName('Cher'), 'Cher'); });
