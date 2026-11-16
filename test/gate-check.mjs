// Gate self-check: the seven rows the sealed scorer checks, run locally on out/.
// Usage: node test/gate-check.mjs [outDir] [snapshotPath]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const outDir = process.argv[2] || 'out';
const snapshotPath = process.argv[3] || '../token-radar-01-kit/input/snapshot.json';
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// 1. dashboard_files
{
  const dir = join(outDir, 'dashboard');
  const files = readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, f)).isFile());
  const total = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const hasHtml = files.includes('index.html');
  const hasCss = files.some((f) => f.endsWith('.css'));
  const hasJs = files.some((f) => f.endsWith('.js'));
  let networkRef = null;
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    if (f.endsWith('.html')) {
      const attrs = text.match(/<[^>]+(href|src|action|poster)\s*=\s*["']https?:[^"']*["']/gi);
      if (attrs) networkRef = `${f}: ${attrs[0]}`;
    }
    if (f.endsWith('.css') && /https?:\/\//.test(text)) networkRef = `${f}: url with http(s)`;
    if (f.endsWith('.js') && /(from\s+['"]https?:|import\s*\(\s*['"]https?:|require\s*\(\s*['"]https?:)/.test(text)) {
      networkRef = `${f}: http(s) import`;
    }
  }
  check('dashboard_files', hasHtml && hasCss && hasJs && files.length <= 400 && total <= 4_194_304 && !networkRef,
    `${files.length} files, ${total} bytes${networkRef ? ', ' + networkRef : ''}`);
}

// 2. board_file + 3. sorted_by_value + 4. coverage + 5. farm_steps
{
  const raw = readFileSync(join(outDir, 'board.json'));
  const board = JSON.parse(raw.toString('utf8'));
  const rows = board.rows;
  let boardOk = Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000 && raw.length <= 8_388_608;
  let boardDetail = `${rows.length} rows, ${raw.length} bytes`;
  const seen = new Set();
  for (const r of rows) {
    if (!snapSlugs.has(r.slug)) { boardOk = false; boardDetail = `invented slug ${r.slug}`; break; }
    if (!r.name || typeof r.name !== 'string') { boardOk = false; boardDetail = `bad name at rank ${r.rank}`; break; }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      boardOk = false; boardDetail = `bad implied value at ${r.slug}`; break;
    }
    seen.add(r.slug);
  }
  check('board_file', boardOk, boardDetail);
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((r, i) => r === i + 1);
  let orderOk = true;
  for (let i = 1; i < rows.length; i++) if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) orderOk = false;
  const allSame = rows.length >= 2 && rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd;
  check('sorted_by_value', ranksOk && orderOk && !allSame, `ranks 1..${rows.length}${!ranksOk ? ' BROKEN' : ''}${!orderOk ? ' NOT SORTED' : ''}`);
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  check('coverage', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : 'all 40 watchlist slugs present');
  let farmOk = true;
  let farmDetail = '';
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) { farmOk = false; farmDetail = `${r.slug}: ${r.farm_steps.length} steps`; break; }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) { farmOk = false; farmDetail = `${r.slug}: step of ${s.length} chars`; break; }
    }
    if (!farmOk) break;
  }
  check('farm_steps', farmOk, farmDetail || 'all rows 6 steps, 20..600 chars');
}

// 6. screenshots
{
  const dir = join(outDir, 'screenshots');
  const names = readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  let ok = names.length >= 3 && names.length <= 4;
  let detail = `${names.length} images`;
  const { default: PNG } = await import('node:zlib').catch(() => ({}));
  for (const name of names) {
    const buf = readFileSync(join(dir, name));
    if (buf.length > 524_288) { ok = false; detail = `${name} over 512 KiB`; break; }
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    if (!isPng && !isJpeg) { ok = false; detail = `${name} not PNG/JPEG`; break; }
    let w = 0, h = 0;
    if (isPng) { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
    if (isJpeg) {
      let i = 2;
      while (i < buf.length - 1) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break;
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    const longSide = Math.max(w, h), shortSide = Math.min(w, h);
    if (longSide > 1440 || shortSide < 800) { ok = false; detail = `${name} is ${w}x${h}`; break; }
    detail += ` · ${name} ${w}x${h} ${Math.round(buf.length / 1024)}KB`;
  }
  check('screenshots', ok, detail);
}

// 7. dossier_matches
{
  const stored = readFileSync(join(outDir, 'dossier.json'));
  const rebuilt = buildDossier(outDir, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
  const same = stored.length === rebuilt.length && Buffer.from(stored).equals(Buffer.from(rebuilt));
  const d = JSON.parse(stored.toString('utf8'));
  check('dossier_matches', same, `${stored.length} bytes, text ${d.text.length} chars, ${d.images.length} images`);
}

console.log(failures === 0 ? 'GATE: all 7 rows pass' : `GATE: ${failures} row(s) failing`);
process.exit(failures === 0 ? 0 : 1);
