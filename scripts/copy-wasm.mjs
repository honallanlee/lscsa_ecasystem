// The barcode engine is served from this site itself, so scanning needs no outside service.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dirname, '..'), out = join(root, 'public/wasm');
mkdirSync(out, { recursive: true });
for (const k of ['reader', 'writer']) copyFileSync(join(root, `node_modules/zxing-wasm/dist/${k}/zxing_${k}.wasm`), join(out, `zxing_${k}.wasm`));
