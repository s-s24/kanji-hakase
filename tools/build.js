// KANJIDIC2 と KanjiVG からアプリ用データを生成する
//   node tools/build.js
// 出力: app/data/kanji.json, app/data/radicals.json, app/data/hw.json, app/data/strokes/XX.json
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'app', 'data');
fs.mkdirSync(path.join(OUT, 'strokes'), { recursive: true });

const gunzip = (p) => zlib.gunzipSync(fs.readFileSync(p)).toString('utf8');
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// ---------- KANJIDIC2 ----------
console.log('KANJIDIC2 を読み込み中...');
const dic = gunzip(path.join(ROOT, 'raw', 'kanjidic', 'kanjidic2.xml.gz'));
const kanji = {}; // char -> entry
const one = (block, re) => { const m = block.match(re); return m ? m[1] : null; };
const all = (block, re) => { const out = []; let m; const g = new RegExp(re.source, 'g'); while ((m = g.exec(block))) out.push(decode(m[1])); return out; };

for (const block of dic.split('<character>').slice(1)) {
  const c = one(block, /<literal>(.*?)<\/literal>/);
  if (!c || c.normalize('NFC') !== c) continue; // 互換漢字(見た目が同じ重複)は除外
  const e = {
    s: +one(block, /<stroke_count>(\d+)<\/stroke_count>/) || 0, // 画数
    r: +one(block, /<rad_value rad_type="classical">(\d+)<\/rad_value>/) || 0, // 部首番号
  };
  const g = one(block, /<grade>(\d+)<\/grade>/); if (g) e.g = +g; // 学年
  const f = one(block, /<freq>(\d+)<\/freq>/); if (f) e.f = +f; // 頻度順位
  const on = all(block, /<reading r_type="ja_on">(.*?)<\/reading>/); if (on.length) e.on = on;
  const kun = all(block, /<reading r_type="ja_kun">(.*?)<\/reading>/); if (kun.length) e.kun = kun;
  const na = all(block, /<nanori>(.*?)<\/nanori>/); if (na.length) e.na = na;
  kanji[c] = e;
}
console.log(`  ${Object.keys(kanji).length} 字`);

// ---------- SVG パスを点列に ----------
function pathToPoints(d) {
  const tok = d.match(/[MmCcSsLlHhVvZzQqTt]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const pts = [];
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lcx = null, lcy = null;
  const num = () => parseFloat(tok[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let k = 1; k <= 10; k++) {
      const t = k / 10, u = 1 - t;
      pts.push([u*u*u*x + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3, u*u*u*y + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3]);
    }
    lcx = x2; lcy = y2; x = x3; y = y3;
  };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; pts.push([x, y]); cmd = rel ? 'l' : 'L'; lcx = null; break;
      case 'L': x = ox + num(); y = oy + num(); pts.push([x, y]); lcx = null; break;
      case 'H': x = ox + num(); pts.push([x, y]); lcx = null; break;
      case 'V': y = oy + num(); pts.push([x, y]); lcx = null; break;
      case 'C': { const a = [num(), num(), num(), num(), num(), num()]; cubic(ox+a[0], oy+a[1], ox+a[2], oy+a[3], ox+a[4], oy+a[5]); break; }
      case 'S': { const a = [num(), num(), num(), num()]; const x1 = lcx == null ? x : 2*x - lcx, y1 = lcy == null ? y : 2*y - lcy; cubic(x1, y1, ox+a[0], oy+a[1], ox+a[2], oy+a[3]); break; }
      case 'Q': { const a = [num(), num(), num(), num()]; const qx = ox+a[0], qy = oy+a[1]; cubic(x+2/3*(qx-x), y+2/3*(qy-y), ox+a[2]+2/3*(qx-ox-a[2]), oy+a[3]+2/3*(qy-oy-a[3]), ox+a[2], oy+a[3]); break; }
      case 'Z': x = sx; y = sy; pts.push([x, y]); break;
      default: i++; // 未対応コマンドは読み飛ばす
    }
  }
  return pts;
}

// 点列を弧長で等分した n 点に
function resample(pts, n) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k-1] + Math.hypot(pts[k][0]-pts[k-1][0], pts[k][1]-pts[k-1][1]));
  const L = cum[cum.length - 1];
  const out = [];
  for (let j = 0; j < n; j++) {
    const target = L * j / (n - 1);
    let k = 1; while (k < pts.length - 1 && cum[k] < target) k++;
    const seg = cum[k] - cum[k-1] || 1, t = Math.min(1, Math.max(0, (target - cum[k-1]) / seg));
    const a = pts[k-1] || pts[0], b = pts[k] || pts[0];
    out.push([a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]);
  }
  return out;
}

// 手書き照合用の特徴量: 各画を4点に等分 → 字全体の外接枠で正規化(縦横比維持) → 0-63 を1文字に
const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
function features(strokes) {
  const rs = strokes.map((s) => resample(s, 4));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const [px, py] of s) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const q = (v, c) => ALPHA[Math.max(0, Math.min(63, Math.round(((v - c) / size + 0.5) * 63)))];
  return rs.map((s) => s.map(([px, py]) => q(px, cx) + q(py, cy)).join('')).join('');
}

// ---------- KanjiVG ----------
console.log('KanjiVG を読み込み中...');
const vg = gunzip(path.join(ROOT, 'raw', 'kanjivg', 'kanjivg.xml.gz'));
const shards = {};
const hw = [];
let nStroke = 0;
for (const block of vg.split('<kanji id="kvg:kanji_').slice(1)) {
  const id = block.slice(0, block.indexOf('"'));
  if (id.includes('-')) continue; // 異体字バリアントは除外
  const c = String.fromCodePoint(parseInt(id, 16));
  if (!kanji[c]) continue;
  const paths = [];
  const re = /<path id="kvg:[0-9a-f]+-s(\d+)"[^>]*?\sd="([^"]+)"/g;
  let m; while ((m = re.exec(block))) paths.push([+m[1], m[2].replace(/\s+/g, ' ').trim()]);
  if (!paths.length) continue;
  paths.sort((a, b) => a[0] - b[0]);
  const ds = paths.map((p) => p[1]);
  const key = (parseInt(id, 16) >> 8).toString(16);
  (shards[key] = shards[key] || {})[c] = ds;
  hw.push([c, features(ds.map(pathToPoints))]);
  // 構成要素(パーツ)
  const parts = new Set();
  const er = /kvg:element="([^"]+)"/g;
  while ((m = er.exec(block))) { const p = decode(m[1]); if (p !== c) parts.add(p); }
  if (parts.size) kanji[c].p = [...parts].join('');
  kanji[c].v = 1; // 筆順データあり
  nStroke++;
}
console.log(`  筆順データ ${nStroke} 字`);

for (const [k, v] of Object.entries(shards)) fs.writeFileSync(path.join(OUT, 'strokes', k + '.json'), JSON.stringify(v));
fs.writeFileSync(path.join(OUT, 'hw.json'), JSON.stringify(hw));
fs.writeFileSync(path.join(OUT, 'kanji.json'), JSON.stringify(kanji));

// ---------- 部首(康熙部首214) ----------
// 日本でよく使う形に置き換え / 画数を補う
const RAD_JA = { 63: ['戸', 4], 174: ['青', 8] };
const radicals = [];
for (let n = 1; n <= 214; n++) {
  const ch = RAD_JA[n] ? RAD_JA[n][0] : String.fromCodePoint(0x2F00 + n - 1).normalize('NFKC');
  radicals.push([n, ch, RAD_JA[n] ? RAD_JA[n][1] : kanji[ch] ? kanji[ch].s : 0]);
}
fs.writeFileSync(path.join(OUT, 'radicals.json'), JSON.stringify(radicals));

// アプリアイコン(「漢」の筆順データから描く)
const iconPaths = shards[(0x6f22 >> 8).toString(16)]['漢'].map((d) => `<path d="${d}"/>`).join('');
fs.writeFileSync(path.join(ROOT, 'app', 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#b33a2b"/>` +
  `<g transform="translate(76 76) scale(3.3)" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${iconPaths}</g></svg>`);

const size = (p) => (fs.statSync(path.join(OUT, p)).size / 1024).toFixed(0) + 'KB';
console.log(`kanji.json ${size('kanji.json')} / hw.json ${size('hw.json')} / strokes ${Object.keys(shards).length} ファイル`);
