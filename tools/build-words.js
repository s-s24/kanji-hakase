// JMdict(語・読み) と 日本語版ウィクショナリー(日本語の意味) から熟語データを生成する
//   node tools/build-words.js
// 入力: raw/jmdict/JMdict_e.gz, raw/wiktionary/jawiktionary.xml(bz2 を展開したもの)
// 出力: app/data/words.json, app/data/wdef/N.json
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'app', 'data');
const BLOCK = 1000; // 意味データの分割単位(語数)

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const hasKanji = (s) => /[㐀-鿿豈-﫿\u{20000}-\u{3134f}々]/u.test(s);
const isKana = (s) => /^[ぁ-ゟ゠-ヿー]+$/.test(s);

// ---------- ウィクショナリーの wikitext を平文に ----------
const POS = {
  noun: '名詞', verb: '動詞', adj: '形容詞', adjective: '形容詞', adjectivenoun: '形容動詞', 'adjective noun': '形容動詞', adjnoun: '形容動詞',
  adverb: '副詞', adv: '副詞', idiom: '成句', pronoun: '代名詞', prefix: '接頭辞', suffix: '接尾辞', interj: '感動詞', interjection: '感動詞',
  conj: '接続詞', conjunction: '接続詞', particle: '助詞', auxverb: '助動詞', 'proper noun': '固有名詞', propn: '固有名詞', prenoun: '連体詞', 'pre-noun adjectival': '連体詞',
  proverb: 'ことわざ', phrase: '成句', expression: '表現', 'kanji': '', counter: '助数詞',
};
const POS_JA = ['名詞', '動詞', '形容詞', '形容動詞', '副詞', '成句', '代名詞', '接頭辞', '接尾辞', '感動詞', '接続詞', '助詞', '助動詞', '固有名詞', '連体詞', 'ことわざ', '慣用句', '四字熟語', '表現', '助数詞', '故事成語'];

function headingPos(h) {
  const t = h.replace(/=/g, '').trim();
  const m = t.match(/^\{\{\s*([^|}]+)/);
  if (m) { const k = m[1].trim().toLowerCase(); return k in POS ? POS[k] || null : null; }
  return POS_JA.find((p) => t.startsWith(p)) || null;
}

// 中身を残すテンプレート: 引数の何番目を表示に使うか
const KEEP = { 'ふりがな': 1, 'ruby': 1, 'l': 2, 'm': 2, 'lang': 2, 'w': 1, 'r': 1, 'vern': 1, 'taxlink': 1, 'term': 2, 'l-self': 2, 'nowrap': 1, 'smallcaps': 1, 'lit': 1, 'gloss': 1, 'unicode': 1 };
function cleanWiki(s) {
  s = s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  // 内側のテンプレートから順に処理
  for (let guard = 0; guard < 10 && /\{\{/.test(s); guard++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const parts = body.split('|').map((x) => x.trim());
      const name = parts[0].toLowerCase();
      const pos = parts.filter((x, i) => i > 0 && !/^[\w-]+=/.test(x)); // 名前付き引数を除く
      const p = (k) => pos[k] || '';
      if (name === 'おくりがな') return p(0) + p(1);                 // {{おくりがな|食|う|くう}} → 食う
      if (name === 'おくりがな2') return p(0) + p(2);                // {{おくりがな2|全|すべ|て|すべて}} → 全て
      if (name === 'おくりがな3') return p(0) + p(2) + p(3) + p(5);  // {{おくりがな3|間|ま||引|び|く|まびく}} → 間引く
      if (name === 'タグ') return pos.length > 1 ? `（${pos.slice(1).join('・')}）` : ''; // 分野ラベル
      if (name in KEEP) return pos[KEEP[name] - 1] || '';
      return '';
    });
  }
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');      // [[a|b]] → b
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1').replace(/\[https?:\/\/[^\]]+\]/g, '');
  s = s.replace(/'''?/g, '').replace(/<[^>]+>/g, '');
  s = decode(s).replace(/\s+/g, ' ').trim();
  s = s.replace(/^[、。:：;\s]+/, '').replace(/（\s*）|\(\s*\)/g, '').trim();
  return s;
}

async function parseWiktionary() {
  console.log('ウィクショナリーを読み込み中(数分かかります)...');
  const pages = new Map(); // title -> { defs: [[pos, def]], refs: [kana] }
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(ROOT, 'raw', 'wiktionary', 'jawiktionary.xml'), 'utf8'), crlfDelay: Infinity });
  let title = null, ns = null, inText = false, inJa = false, pos = null, defs = null, refs = null;
  const finish = () => {
    if (title && defs && (defs.length || refs.length)) pages.set(title, { defs, refs });
    defs = null;
  };
  for await (let line of rl) {
    if (!inText) {
      let m;
      if ((m = line.match(/<title>(.*)<\/title>/))) { title = decode(m[1]); continue; }
      if ((m = line.match(/<ns>(\d+)<\/ns>/))) { ns = m[1]; continue; }
      const t = line.indexOf('<text');
      if (t < 0) continue;
      if (ns !== '0' || !(hasKanji(title) || isKana(title)) || line.includes('/>')) continue;
      inText = true; inJa = false; pos = null; defs = []; refs = [];
      line = line.slice(line.indexOf('>', t) + 1);
    }
    const end = line.indexOf('</text>');
    if (end >= 0) line = line.slice(0, end);
    line = decode(line);

    if (/^==[^=]/.test(line)) {                 // 言語の見出し
      inJa = /^==\s*(\{\{L\|ja\}\}|\{\{ja\}\}|日本語)\s*==/.test(line);
      pos = null;
    } else if (inJa && /^===/.test(line)) {     // 品詞などの見出し
      const p = headingPos(line);
      if (p !== null || /^===[^=]/.test(line)) pos = p;
    } else if (inJa && /^#[^:*#]/.test(line)) { // 語義
      const ref = line.match(/\{\{wagokanji of\|([^|}]+)/);
      if (ref) refs.push(ref[1].trim());
      const d = cleanWiki(line.slice(1).replace(/\{\{wagokanji of\|[^}]*\}\}/g, ''));
      const see = d.match(/^「([^」]+)」(?:を|の項を)?参照。?$/); // 「すべて」を参照 → その記事の語義を使う
      if (see) refs.push(see[1]);
      else if (d && d.length > 1 && !/^(→|⇒)/.test(d)) defs.push([pos || '', d.slice(0, 300)]);
    }
    if (end >= 0) { inText = false; finish(); }
  }
  console.log(`  日本語の語義があるページ ${pages.size}`);
  return pages;
}

// ---------- JMdict ----------
function parseJMdict() {
  console.log('JMdict を読み込み中...');
  const xml = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'raw', 'jmdict', 'JMdict_e.gz'))).toString('utf8');
  const entries = [];
  let i = xml.indexOf('<entry>');
  while (i >= 0) {
    const j = xml.indexOf('</entry>', i);
    const e = xml.slice(i, j);
    i = xml.indexOf('<entry>', j);
    const kebs = [...e.matchAll(/<keb>(.*?)<\/keb>/g)].map((m) => decode(m[1]));
    if (!kebs.length || !hasKanji(kebs[0])) continue;
    // 古い・まれな表記を除いた表記
    const forms = [];
    for (const k of e.match(/<k_ele>[\s\S]*?<\/k_ele>/g)) {
      if (/&(oK|iK|rK|sK|ik|io);/.test(k)) continue;
      forms.push(decode(k.match(/<keb>(.*?)<\/keb>/)[1]));
    }
    if (!forms.length) continue;
    const rebs = [];
    for (const r of e.match(/<r_ele>[\s\S]*?<\/r_ele>/g)) {
      if (/<re_nokanji|&(ok|ik|rk|sk);/.test(r)) continue;
      rebs.push(decode(r.match(/<reb>(.*?)<\/reb>/)[1]));
    }
    if (!rebs.length) continue;
    const pri = e.match(/<ke_pri>(.*?)<\/ke_pri>/g) || [];
    const priText = pri.join(' ');
    const common = /news1|ichi1|spec1|spec2|gai1/.test(priText);
    const nf = priText.match(/nf(\d\d)/);
    entries.push({ forms, rebs, common, rank: nf ? +nf[1] : common ? 49 : 60 });
  }
  console.log(`  漢字を含む語 ${entries.length}`);
  return entries;
}

(async () => {
  const entries = parseJMdict();
  const pages = await parseWiktionary();

  // 意味を引く(漢字の表記 → 参照先のかなの記事)
  const lookup = (forms, rebs) => {
    for (const f of forms) {
      const p = pages.get(f);
      if (!p) continue;
      let defs = p.defs.slice();
      for (const r of p.refs) { const q = pages.get(r); if (q) defs = defs.concat(q.defs); }
      const seen = new Set();
      defs = defs.filter(([, d]) => !seen.has(d) && seen.add(d)).slice(0, 12); // 重複を除く
      if (defs.length) return defs;
    }
    return null;
  };

  const words = [];
  for (const e of entries) {
    const defs = lookup(e.forms, e.rebs);
    if (!e.common && !defs) continue; // よく使う語か、日本語の意味がある語だけ残す
    words.push({ ...e, defs });
  }
  // 並び順 = 優先度(よく使う・意味あり・短い語を先に)
  words.sort((a, b) => (a.rank - b.rank) || ((b.defs ? 1 : 0) - (a.defs ? 1 : 0)) || (a.forms[0].length - b.forms[0].length));

  fs.rmSync(path.join(OUT, 'wdef'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'wdef'), { recursive: true });
  // words.json: [表記(・区切り), 読み(・区切り), フラグ(1=よく使う 2=意味あり), 短い意味]
  const list = words.map((w) => [w.forms.join('・'), w.rebs.join('・'), (w.common ? 1 : 0) | (w.defs ? 2 : 0), w.defs ? w.defs[0][1].slice(0, 40) : '']);
  fs.writeFileSync(path.join(OUT, 'words.json'), JSON.stringify(list));
  for (let b = 0; b * BLOCK < words.length; b++) {
    fs.writeFileSync(path.join(OUT, 'wdef', b + '.json'), JSON.stringify(words.slice(b * BLOCK, (b + 1) * BLOCK).map((w) => w.defs)));
  }
  const withDef = words.filter((w) => w.defs).length;
  console.log(`熟語 ${words.length} 語(日本語の意味あり ${withDef} 語) / words.json ${(fs.statSync(path.join(OUT, 'words.json')).size / 1024 / 1024).toFixed(1)}MB`);
})();
