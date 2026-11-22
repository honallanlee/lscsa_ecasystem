import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareZXingModule as readerModule, readBarcodes } from 'zxing-wasm/reader';
import { prepareZXingModule as writerModule, writeBarcode } from 'zxing-wasm/writer';
import { addClub, classify, createGate } from '../src/lib/scan.ts';
import { parseCsv } from '../src/lib/csv.ts';

const wasm = (k: string) => new Uint8Array(readFileSync(new URL(`../node_modules/zxing-wasm/dist/${k}/zxing_${k}.wasm`, import.meta.url))).buffer;
readerModule({ overrides: { wasmBinary: wasm('reader') } });
writerModule({ overrides: { wasmBinary: wasm('writer') } });
const codes = parseCsv(readFileSync(new URL('../db/demo/clubs.csv', import.meta.url), 'utf8')).slice(1).map(r => r[0]!);
const clubs = new Set(codes);

test('scanned text: student slips, club labels, anything else', () => {
  assert.deepEqual(classify('*S90001*', clubs), { kind: 'student', regNo: 's90001' });
  assert.deepEqual(classify('90001', clubs), { kind: 'student', regNo: 's90001' });
  assert.deepEqual(classify(' s18 ', clubs), { kind: 'club', code: 'S18' });
  assert.equal(classify('https://example.com', clubs).kind, 'unknown');
  assert.equal(classify('Z99', clubs).kind, 'unknown');
  assert.deepEqual(codes.filter(c => classify(c, clubs).kind !== 'club'), [], 'no club is ever taken for a student');
});
test('one blurred read is ignored, two matching reads count once', () => {
  const g = createGate();
  assert.equal(g.push('s90001', 0), false);
  assert.equal(g.push('s90007', 100), false, 'a misread');
  assert.equal(g.push('s90001', 200), false, 'the streak was broken');
  assert.equal(g.push('s90001', 300), true);
  for (let t = 400; t < 6000; t += 100) assert.equal(g.push('s90001', t), false, 'still in view');
  assert.equal(g.push('s90001', 8000), false); assert.equal(g.push('s90001', 8100), true, 'shown again later');
});
test('two reads far apart do not count; busy scans can retry at once', () => {
  const g = createGate();
  assert.equal(g.push('A01', 0), false); assert.equal(g.push('A01', 2000), false);
  assert.equal(g.push('A01', 2100), true); g.release('A01');
  assert.equal(g.push('A01', 2200), false); assert.equal(g.push('A01', 2300), true);
});
test('clubs fill empty slots, never twice, never past the limit', () => {
  assert.deepEqual(addClub(['A01', '', ''], 'C01', 3), { codes: ['A01', 'C01', ''], result: 'added' });
  assert.equal(addClub(['a01', ''], 'A01', 2).result, 'already');
  assert.equal(addClub(['A01', 'C01'], 'S01', 2).result, 'full');
  assert.deepEqual(addClub([], 'S01', 1).codes, ['S01']);
});

/** Draws a code the way a hand-held phone might see it: small, tilted, dim on one side, soft and grainy. */
async function photo(value: string, format: 'Code39' | 'Code128' | 'QRCode', o: { width: number; tilt: number; blur: number; noise: number; shade: number }) {
  const { symbol } = await writeBarcode(value, { format }), W = 900, H = 500, img = new Float64Array(W * H).fill(235);
  const oneD = format !== 'QRCode', bw = o.width, bh = oneD ? bw * 0.35 : bw, cos = Math.cos(o.tilt), sin = Math.sin(o.tilt);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - W / 2, dy = y - H / 2, u = (dx * cos + dy * sin) / bw + 0.5, v = (-dx * sin + dy * cos) / bh + 0.5;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const sx = Math.floor(u * symbol.width), sy = Math.floor(v * symbol.height);
    if (symbol.data[sy * symbol.width + sx]! < 128) img[y * W + x] = 40;
  }
  let soft = img;
  for (let k = 0; k < o.blur; k++) { const n = soft.slice(); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let t = 0; for (let j = -1; j < 2; j++) for (let i = -1; i < 2; i++) t += soft[(y + j) * W + x + i]!; n[y * W + x] = t / 9; } soft = n; }
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const p = soft[i]! * (1 - o.shade * ((i % W) / W)) + rnd() * o.noise; data.set([p, p, p, 255], i * 4); }
  return { data, width: W, height: H, colorSpace: 'srgb' } as ImageData;
}
const read = async (img: ImageData) => (await readBarcodes(img, { formats: ['Code39', 'Code128', 'QRCode'], tryHarder: true, maxNumberOfSymbols: 1 })).find(r => r.isValid)?.text;

test('every club label and sample slips decode, in all three formats', async () => {
  const wrong: string[] = [], missed: string[] = [];
  for (const value of [...codes, 'S90001', 's90001', 'S90990', 'S12345']) for (const format of ['Code39', 'Code128', 'QRCode'] as const) {
    if (format === 'Code39' && value !== value.toUpperCase()) continue;
    const got = await read(await photo(value, format, { width: format === 'QRCode' ? 260 : 520, tilt: 0.07, blur: 1, noise: 30, shade: 0.35 }));
    if (got === undefined) missed.push(format + ' ' + value); else if (got !== value) wrong.push(`${format} ${value} read as ${got}`);
  }
  assert.deepEqual(wrong, []); assert.deepEqual(missed, []);
});
test('harsh conditions: may fail to read, must never read the wrong value', async () => {
  const score: Record<string, string> = {};
  for (const format of ['Code39', 'Code128', 'QRCode'] as const) {
    let ok = 0, n = 0;
    for (const value of ['S90001', 'S90017', 'S18', 'U02']) for (const width of [160, 240, 360]) for (const tilt of [0, 0.25, 0.6]) for (const blur of [1, 3]) {
      const got = await read(await photo(value, format, { width, tilt, blur, noise: 60, shade: 0.5 }));
      n++;
      if (got !== undefined) { assert.equal(got, value, `${format} w${width} tilt${tilt} blur${blur}`); ok++; }
    }
    score[format] = `${ok}/${n}`;
  }
  console.log('  read in harsh conditions:', score);
});
