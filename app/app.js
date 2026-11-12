'use strict';
// ===== 漢字辞典 =====
// データ: KANJIDIC2 (EDRDG, CC BY-SA 4.0) / KanjiVG (Ulrich Apel, CC BY-SA 3.0)

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
};

let K = {};            // 漢字 -> データ
let KEYS = [];         // 全漢字
let RAD = [];          // [番号, 字, 画数]
const strokeCache = {};
const LIMIT = 240;
let view = 'home'; // 'home' | 'results'

// ---- 熟語データ(JMdict + ウィクショナリー)。大きいので後から読み込む ----
let W = null;          // [{ i, forms, f, reads, fl, s }]
let WIDX = null;       // 表記 -> 熟語
let wordsLoading = null;
const wdefCache = {};
const WLIMIT = 50;
function loadWords() {
  if (!wordsLoading) {
    wordsLoading = fetch('data/words.json').then((r) => r.json()).then((list) => {
      W = list.map(([f, r, fl, s], i) => ({ i, forms: f.split('・'), f, reads: r.split('・'), fl, s }));
      WIDX = new Map();
      for (const w of W) for (const x of w.forms) if (!WIDX.has(x)) WIDX.set(x, w);
      return W;
    }).catch(() => { wordsLoading = null; return null; });
  }
  return wordsLoading;
}
async function loadDefs(i) {
  const b = Math.floor(i / 1000);
  if (!wdefCache[b]) {
    try { wdefCache[b] = await fetch(`data/wdef/${b}.json`).then((r) => r.json()); } catch { return undefined; }
  }
  return wdefCache[b][i % 1000];
}
// 表記で探す: 完全一致 → 前方一致 → 部分一致(それぞれよく使う語が先)
function wordsByText(q) {
  if (!W) return [];
  const exact = [], starts = [], inc = [];
  for (const w of W) {
    if (!w.f.includes(q)) continue;
    if (w.forms.includes(q)) exact.push(w);
    else if (w.forms.some((x) => x.startsWith(q))) starts.push(w);
    else inc.push(w);
  }
  return exact.concat(starts, inc);
}
// 読みで探す: 完全一致 → 前方一致
function wordsByReading(hira, kata) {
  if (!W) return [];
  const exact = [], starts = [];
  for (const w of W) {
    if (w.reads.some((r) => r === hira || r === kata)) exact.push(w);
    else if (w.reads.some((r) => r.startsWith(hira) || r.startsWith(kata))) starts.push(w);
  }
  return exact.concat(starts);
}
const wordSection = (title, words) => (W ? (words.length ? { title, words } : null) : { title: '熟語', loading: true });

// 部首の日本での呼び名で見かける形(表示用)
const RAD_ALT = { 9: '亻', 18: '刂', 26: '㔾', 47: '巛', 58: '彐', 61: '忄', 64: '扌', 66: '攵', 85: '氵', 86: '灬', 87: '爫', 93: '牜', 94: '犭', 96: '王', 113: '礻', 122: '罒', 125: '耂', 130: '⺼', 140: '艹', 145: '衤', 162: '辶', 163: '阝', 170: '阝', 184: '飠' };

// ---- 保存(履歴・お気に入り) ----
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const addHistory = (c) => store.set('history', [c, ...store.get('history').filter((x) => x !== c)].slice(0, 60));
const isFav = (c) => store.get('fav').includes(c);
const toggleFav = (c) => {
  const f = store.get('fav');
  store.set('fav', f.includes(c) ? f.filter((x) => x !== c) : [c, ...f]);
  return !f.includes(c);
};

// ---- 文字種 ----
const isKanji = (ch) => /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3134f}⺀-⿟㇀-㇯]/u.test(ch);
const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toHalfNum = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

const gradeLabel = (g) => !g ? '表外' : g <= 6 ? `小学${g}年` : g === 8 ? '中学（常用）' : '人名用';
const mainReading = (e) => (e.kun && toHira(e.kun[0].split('.')[0].replace(/-/g, ''))) || (e.on && e.on[0]) || '';

// 並び順: よく使う字が先
const byFreq = (a, b) => (K[a].f || 9999) - (K[b].f || 9999) || (K[a].g || 99) - (K[b].g || 99) || K[a].s - K[b].s;
const byStroke = (a, b) => K[a].s - K[b].s || byFreq(a, b);

// ===== 検索 =====
function search(raw) {
  const q = toHalfNum(raw.trim());
  if (!q) return null;

  // 画数: 「12」「12画」
  let m = q.match(/^(\d{1,2})\s*画?$/);
  if (m) {
    const n = +m[1];
    return [{ title: `${n}画の漢字`, list: KEYS.filter((c) => K[c].s === n).sort(byFreq) }];
  }

  const chars = [...q].filter((ch) => !/\s/.test(ch));
  const kanjiChars = [...new Set(chars.filter(isKanji))];
  const kana = chars.filter((ch) => !isKanji(ch)).join('');

  const sections = [];
  if (kanjiChars.length) {
    const found = kanjiChars.filter((c) => K[c]);
    if (found.length) sections.push({ title: '入力した漢字', list: found });
    // パーツ検索: 入力したすべての字を部品に含む漢字
    const partsOf = (c) => (K[c].p || '') + RAD_CHAR(K[c].r);
    let list = KEYS.filter((c) => !kanjiChars.includes(c) && kanjiChars.every((p) => partsOf(c).includes(p)));
    if (kana) list = list.filter((c) => readingScore(K[c], toHira(kana), toKata(kana)) < 9);
    list.sort(byStroke);
    if (list.length) sections.push({ title: `「${kanjiChars.join('')}」を含む漢字`, list, showStroke: true });
    // 熟語: 2字以上なら熟語を先頭に、1字なら「入力した漢字」の次に
    const text = chars.join('');
    const ws = wordSection(`「${text}」の熟語`, wordsByText(text));
    if (ws) sections.splice([...text].length >= 2 ? 0 : found.length ? 1 : 0, 0, ws);
    return sections;
  }

  // 読み
  if (/^[ぁ-ゖァ-ーー]+$/.test(kana)) {
    const hira = toHira(kana), kata = toKata(kana);
    const scored = [];
    for (const c of KEYS) {
      const sc = readingScore(K[c], hira, kata);
      if (sc < 9) scored.push([c, sc]);
    }
    scored.sort((a, b) => a[1] - b[1] || byFreq(a[0], b[0]));
    const exact = scored.filter((x) => x[1] <= 1).map((x) => x[0]);
    const prefix = scored.filter((x) => x[1] > 1).map((x) => x[0]);
    if (exact.length) sections.push({ title: `「${hira}」と読む漢字`, list: exact, reading: hira });
    const ws = wordSection(`「${hira}」と読む熟語`, wordsByReading(hira, kata));
    if (ws) sections.push(ws);
    if (prefix.length) sections.push({ title: `「${hira}…」で始まる読みの漢字`, list: prefix, reading: hira });
    return sections;
  }
  return [];
}

// 0: 完全一致 / 1: 送り仮名を除いて一致 / 2: 前方一致 / 9: 該当なし
function readingScore(e, hira, kata) {
  let best = 9;
  if (e.on) for (const r of e.on) {
    const x = r.replace(/-/g, '');
    if (x === kata) return 0;
    if (x.startsWith(kata)) best = Math.min(best, 2);
  }
  if (e.kun) for (const r of e.kun) {
    const x = r.replace(/-/g, '');
    const full = x.replace('.', ''), stem = x.split('.')[0];
    if (full === hira) return 0;
    if (stem === hira) best = Math.min(best, 1);
    else if (full.startsWith(hira)) best = Math.min(best, 2);
  }
  return best;
}

const RAD_CHAR = (n) => (RAD[n - 1] ? RAD[n - 1][1] : '');

// ===== 結果表示 =====
function tile(c, sub) {
  return el('button', { class: 'tile', onclick: () => openDetail(c) },
    el('span', { class: 'c' }, c), el('span', { class: 'r' }, sub ?? mainReading(K[c])));
}

function renderSections(sections) {
  const box = $('#results');
  box.textContent = '';
  view = sections ? 'results' : 'home';
  if (!sections) return renderHome();
  if (!sections.length || sections.every((s) => !(s.loading || (s.list || s.words).length))) {
    box.append(el('p', { class: 'empty' }, '見つかりませんでした'));
    return;
  }
  for (const s of sections) {
    if (s.loading) {
      box.append(el('div', { class: 'sec' }, el('span', {}, s.title)), el('p', { class: 'muted' }, '熟語データを読み込み中…'));
      continue;
    }
    if (s.words) {
      box.append(el('div', { class: 'sec' }, el('span', {}, s.title), el('span', {}, `${s.words.length}語`)));
      box.append(wordList(s.words, WLIMIT));
      continue;
    }
    box.append(el('div', { class: 'sec' }, el('span', {}, s.title), el('span', {}, `${s.list.length}字`)));
    const grid = el('div', { class: 'grid' });
    const sub = (c) => s.showStroke ? `${K[c].s}画` : s.reading ? matchedReading(K[c], s.reading) : undefined;
    const draw = (from) => { for (const c of s.list.slice(from, from + LIMIT)) grid.append(tile(c, sub(c))); };
    draw(0);
    box.append(grid);
    if (s.list.length > LIMIT) {
      let shown = LIMIT;
      const more = el('button', { class: 'more', onclick: () => { draw(shown); shown += LIMIT; if (shown >= s.list.length) more.remove(); } }, 'もっと見る');
      box.append(more);
    }
  }
}

// 熟語の一覧(limit 件ずつ「もっと見る」)
function wordRow(w) {
  return el('button', { class: 'wrow', onclick: () => openWord(w.i) },
    el('span', { class: 'wf' }, w.forms[0]),
    el('span', { class: 'wr' }, w.reads[0]),
    el('span', { class: 'ws' }, w.s || (w.fl & 2 ? '' : '（日本語の意味データなし）')));
}
function wordList(words, limit, onMore) {
  const box = el('div', { class: 'wlist' });
  const draw = (from) => words.slice(from, from + limit).forEach((w) => box.append(wordRow(w)));
  draw(0);
  if (words.length <= limit) return box;
  const wrap = el('div', {}, box);
  let shown = limit;
  const more = el('button', { class: 'more', onclick: () => {
    if (onMore) return onMore();
    draw(shown); shown += limit; if (shown >= words.length) more.remove();
  } }, onMore ? `すべて見る（${words.length}語）` : 'もっと見る');
  wrap.append(more);
  return wrap;
}

// タイル下に、検索した読みに合ったものを出す
function matchedReading(e, hira) {
  const kata = toKata(hira);
  for (const r of e.kun || []) if (r.replace(/[-.]/g, '').startsWith(hira) || r.split('.')[0] === hira) return r.replace(/-/g, '').replace('.', '');
  for (const r of e.on || []) if (r.startsWith(kata)) return r;
  return mainReading(e);
}

function renderHome() {
  const box = $('#results');
  // 漢字は「海」、熟語は「w:海岸」の形で保存している
  const split = (keys) => [keys.filter((c) => K[c]), WIDX ? keys.filter((k) => k.startsWith('w:') && WIDX.has(k.slice(2))).map((k) => WIDX.get(k.slice(2))) : []];
  const [favK, favW] = split(store.get('fav'));
  const [histK, histW] = split(store.get('history'));
  const block = (title, ks, ws) => {
    if (!ks.length && !ws.length) return;
    box.append(el('div', { class: 'sec' }, el('span', {}, title)));
    if (ks.length) { const g = el('div', { class: 'grid' }); ks.forEach((c) => g.append(tile(c))); box.append(g); }
    if (ws.length) box.append(el('div', { style: ks.length ? 'margin-top:8px' : '' }, wordList(ws, 10)));
  };
  block('★ お気に入り', favK, favW);
  block('最近見た漢字・熟語', histK.slice(0, 24), histW.slice(0, 10));
  const help = el('div', { class: 'help' });
  help.innerHTML = `<b>こんな探し方ができます</b><ul>
    <li><b>熟語</b>：「海岸」「かいがん」→ 読みと意味</li>
    <li><b>読み</b>：「うみ」「カイ」</li>
    <li><b>パーツ</b>：「氵」「木口」→ その部品を含む漢字</li>
    <li><b>パーツ＋読み</b>：「木 ま」→ 木を含み「ま…」と読む字</li>
    <li><b>画数</b>：「12」「12画」</li>
    <li><b>手書き</b>：書いた字が検索欄に入るので、続けて書けば熟語も探せます</li>
    <li><b>部首</b>：上のボタンから</li></ul>`;
  box.append(el('div', { class: 'sec' }), help);
}

// ===== 詳細画面 =====
async function openDetail(c, push = true) {
  const e = K[c];
  if (!e) return;
  addHistory(c);
  if (push) history.pushState({ k: c }, '', '#k=' + encodeURIComponent(c));
  showOverlay(c, c);

  const body = $('#detail-body');
  const radN = e.r, radC = RAD_CHAR(radN);

  const readBtn = (label, q, ok) => el('button', { onclick: () => goSearch(q) }, label, ok ? el('span', { class: 'ok' }, ok) : null);

  body.append(
    el('div', { class: 'hero' },
      el('div', { class: 'big' }, c),
      el('div', { class: 'meta' },
        el('div', {}, el('span', { class: 'badge' }, gradeLabel(e.g))),
        el('div', {}, '画数', el('b', {}, `${e.s}画`)),
        el('div', {}, '部首', el('b', {}, `${radC}${RAD_ALT[radN] ? `（${RAD_ALT[radN]}）` : ''}`)),
        e.f ? el('div', {}, '使用頻度', el('b', {}, `${e.f}位`)) : null,
      ),
    ),
  );

  const readCard = el('div', { class: 'card' });
  const onBox = el('div', { class: 'reads' });
  (e.on || []).forEach((r) => onBox.append(readBtn(r, r.replace(/-/g, ''))));
  if (!e.on) onBox.append(el('span', { class: 'none' }, 'なし'));
  const kunBox = el('div', { class: 'reads' });
  (e.kun || []).forEach((r) => {
    const [stem, ok] = r.split('.');
    kunBox.append(readBtn(stem, stem.replace(/-/g, ''), ok ? ok : null));
  });
  if (!e.kun) kunBox.append(el('span', { class: 'none' }, 'なし'));
  readCard.append(el('h3', {}, '音読み'), onBox, el('h3', { style: 'margin-top:12px' }, '訓読み'), kunBox);
  if (e.na) {
    const naBox = el('div', { class: 'reads' });
    e.na.forEach((r) => naBox.append(el('button', { onclick: () => goSearch(r) }, r)));
    readCard.append(el('details', { style: 'margin-top:12px' }, el('summary', {}, `名乗り（人名の読み） ${e.na.length}件`), naBox));
  }
  body.append(readCard);

  // 筆順
  const strokeCard = el('div', { class: 'card' }, el('h3', {}, '筆順'));
  body.append(strokeCard);

  // この字を使う熟語
  const wordCard = el('div', { class: 'card' }, el('h3', {}, 'この字を使う熟語'));
  const wordWait = el('p', { class: 'nodata' }, '読み込み中…');
  wordCard.append(wordWait);
  body.append(wordCard);
  loadWords().then(() => {
    wordWait.remove();
    if (!W) { wordCard.append(el('p', { class: 'nodata' }, '熟語データを読み込めませんでした（オフライン？）')); return; }
    const ws = W.filter((w) => w.forms[0] !== c && w.forms[0].includes(c));
    if (!ws.length) { wordCard.append(el('p', { class: 'nodata' }, '収録している熟語はありません')); return; }
    wordCard.append(wordList(ws, 12, () => goSearch(c)));
  });

  // パーツ・部首
  const parts = [...new Set([...(e.p || '')])].filter((p) => p !== c);
  const partCard = el('div', { class: 'card' }, el('h3', {}, '部品から探す'));
  const pBox = el('div', { class: 'reads parts' });
  pBox.append(el('button', { onclick: () => { closeDetail(); showRadical(radN); } }, radC, el('span', { class: 'ok', style: 'font-size:12px' }, ' 部首')));
  parts.forEach((p) => p !== radC && pBox.append(el('button', { onclick: () => goSearch(p) }, p)));
  partCard.append(pBox);
  body.append(partCard);

  body.append(el('p', { class: 'credit' }, '出典: KANJIDIC2 (EDRDG, CC BY-SA 4.0) / 筆順: KanjiVG (Ulrich Apel, CC BY-SA 3.0)'));

  if (!e.v) { strokeCard.append(el('p', { class: 'nodata' }, 'この字の筆順データはありません')); return; }
  const strokes = await loadStrokes(c);
  if (!strokes) { strokeCard.append(el('p', { class: 'nodata' }, '筆順データを読み込めませんでした（オフライン？）')); return; }
  if (history.state?.k !== c && push) return; // 別の字に移動済み
  buildStrokeView(strokeCard, strokes);
}

// 詳細画面を開いて、上部バー(お気に入り・コピー)を設定
function showOverlay(favKey, copyText) {
  $('#detail').hidden = false;
  $('#detail').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  stopAnim();
  $('#detail-body').textContent = '';
  const paint = (on) => { $('#fav').textContent = on ? '★' : '☆'; $('#fav').classList.toggle('on', on); };
  paint(isFav(favKey));
  $('#fav').onclick = () => { const on = toggleFav(favKey); paint(on); toast(on ? 'お気に入りに追加' : 'お気に入りから外しました'); };
  $('#copy').onclick = () => navigator.clipboard?.writeText(copyText).then(() => toast(`「${copyText}」をコピーしました`), () => toast('コピーできませんでした'));
}
const goSearch = (q) => { closeDetail(); setQuery(q); };

// ===== 熟語の詳細 =====
async function openWord(i, push = true) {
  await loadWords();
  const w = W && W[i];
  if (!w) return;
  const word = w.forms[0];
  addHistory('w:' + word);
  if (push) history.pushState({ w: i }, '', '#w=' + i);
  showOverlay('w:' + word, word);
  const body = $('#detail-body');

  body.append(el('div', { class: 'whero' },
    el('div', { class: 'wbig' }, word),
    el('div', { class: 'wread' }, w.reads.join('・')),
    w.forms.length > 1 ? el('div', { class: 'muted' }, '別の書き方：' + w.forms.slice(1).join('・')) : null,
    w.fl & 1 ? el('span', { class: 'badge', style: 'margin-top:6px' }, 'よく使う語') : null));

  const defCard = el('div', { class: 'card' }, el('h3', {}, '意味'));
  body.append(defCard);

  // 使われている漢字
  const ks = [...new Set([...word].filter((ch) => K[ch]))];
  if (ks.length) {
    const g = el('div', { class: 'grid' });
    ks.forEach((c) => g.append(tile(c)));
    body.append(el('div', { class: 'card' }, el('h3', {}, '使われている漢字'), g));
  }
  body.append(el('p', { class: 'credit' }, '意味: ウィクショナリー日本語版 (CC BY-SA 4.0) / 語・読み: JMdict (EDRDG, CC BY-SA 4.0)'));

  const defs = await loadDefs(i);
  if (history.state?.w !== i) return; // 別の画面に移動済み
  const web = el('a', { href: `https://www.google.com/search?q=${encodeURIComponent(word + ' 意味')}`, target: '_blank', rel: 'noopener' }, 'Webで調べる');
  if (defs === undefined) { defCard.append(el('p', { class: 'nodata' }, '意味データを読み込めませんでした（オフライン？）')); return; }
  if (!defs) { defCard.append(el('p', { class: 'nodata' }, '日本語の意味データがありません。'), el('p', { class: 'links' }, web)); return; }
  const ol = el('ol', { class: 'defs' });
  let lastPos = null;
  for (const [pos, d] of defs) {
    ol.append(el('li', {}, pos && pos !== lastPos ? el('span', { class: 'pos' }, pos) : null, d));
    if (pos) lastPos = pos;
  }
  defCard.append(ol, el('p', { class: 'links' },
    el('a', { href: `https://ja.wiktionary.org/wiki/${encodeURIComponent(word)}`, target: '_blank', rel: 'noopener' }, 'ウィクショナリーで見る'), '　', web));
}

function closeDetail() {
  if (history.state?.k || history.state?.w != null) history.back();
  else hideDetail();
}
function hideDetail() {
  $('#detail').hidden = true;
  document.body.style.overflow = '';
  stopAnim();
  if (view === 'home') renderSections(null); // 履歴を更新
}

async function loadStrokes(c) {
  const key = (c.codePointAt(0) >> 8).toString(16);
  if (!strokeCache[key]) {
    try { strokeCache[key] = await fetch(`data/strokes/${key}.json`).then((r) => r.json()); } catch { return null; }
  }
  return strokeCache[key][c];
}

const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
function charSvg(cls) {
  const s = svgEl('svg', { viewBox: '0 0 109 109', class: cls });
  s.append(svgEl('line', { x1: 54.5, y1: 2, x2: 54.5, y2: 107, class: 'guide' }), svgEl('line', { x1: 2, y1: 54.5, x2: 107, y2: 54.5, class: 'guide' }));
  return s;
}

let animTimer = null;
const stopAnim = () => { clearTimeout(animTimer); animTimer = null; };

function buildStrokeView(card, strokes) {
  const svg = charSvg('anim');
  strokes.forEach((d) => svg.append(svgEl('path', { d, class: 'ghost' })));
  const inks = strokes.map((d) => { const p = svgEl('path', { d, class: 'ink' }); svg.append(p); return p; });
  const count = el('span', { class: 'count' });
  let step = 0;

  const show = (n, animateLast) => {
    stopAnim();
    step = n;
    inks.forEach((p, i) => {
      const len = p.getTotalLength();
      p.style.transition = 'none';
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = i < n ? 0 : len;
      p.classList.toggle('cur', i === n - 1 && n < inks.length);
    });
    if (animateLast && n > 0) {
      const p = inks[n - 1], len = p.getTotalLength();
      p.style.strokeDashoffset = len;
      p.getBoundingClientRect(); // 再描画させてからアニメーション
      p.style.transition = `stroke-dashoffset ${Math.max(0.25, len / 120)}s linear`;
      p.style.strokeDashoffset = 0;
    }
    count.textContent = `${n} / ${inks.length} 画`;
  };
  const play = () => {
    show(0);
    let i = 0;
    const next = () => {
      i++; show(i, true);
      if (i < inks.length) animTimer = setTimeout(next, Math.max(300, inks[i - 1].getTotalLength() / 120 * 1000) + 180);
    };
    animTimer = setTimeout(next, 200);
  };

  card.append(el('div', { class: 'anim-wrap' }, svg,
    el('div', { class: 'anim-ctrl' },
      el('button', { onclick: play }, '▶ 再生'),
      el('button', { onclick: () => show(step >= inks.length ? 1 : step + 1, true) }, '一画ずつ'),
      count)));

  // 一覧
  const grid = el('div', { class: 'steps' });
  strokes.forEach((_, n) => {
    const s = charSvg();
    strokes.forEach((d, i) => s.append(svgEl('path', { d, class: i < n ? 'ink' : i === n ? 'ink cur' : 'ghost' })));
    const start = strokes[n].match(/-?[\d.]+/g);
    if (start) { const t = svgEl('text', { x: +start[0] - 5, y: +start[1] - 3, class: 'no' }); t.textContent = n + 1; s.append(t); }
    grid.append(el('figure', {}, s, el('figcaption', {}, String(n + 1))));
  });
  card.append(grid);
  play();
}

// ===== 入力・モード =====
let debounce;
function setQuery(q) { $('#q').value = q; onInput(); }
function onInput() {
  $('#clear').hidden = !$('#q').value;
  clearTimeout(debounce);
  debounce = setTimeout(() => { renderSections(search($('#q').value)); window.scrollTo(0, 0); }, 120);
}

function setMode(mode) {
  const hwOn = mode === 'hw' && $('#hw').hidden;
  const radOn = mode === 'rad' && $('#rad').hidden;
  $('#hw').hidden = !hwOn; $('#rad').hidden = !radOn;
  $('#btn-hw').setAttribute('aria-pressed', hwOn);
  $('#btn-rad').setAttribute('aria-pressed', radOn);
  if (hwOn) { $('#q').blur(); initPad(); }
  if (radOn) { $('#q').blur(); buildRadicalPanel(); }
}

function buildRadicalPanel() {
  const box = $('#rad');
  if (box.childElementCount) return;
  const groups = {};
  for (const [n, ch, s] of RAD) (groups[s] = groups[s] || []).push([n, ch]);
  for (const s of Object.keys(groups).sort((a, b) => a - b)) {
    const g = el('div', { class: 'rad-group' }, el('span', { class: 'num' }, `${s}画`));
    for (const [n, ch] of groups[s]) g.append(el('button', { onclick: () => showRadical(n) }, ch, RAD_ALT[n] ? el('small', {}, RAD_ALT[n]) : null));
    box.append(g);
  }
}

function showRadical(n) {
  $('#q').value = ''; $('#clear').hidden = true;
  const list = KEYS.filter((c) => K[c].r === n).sort(byStroke);
  renderSections([{ title: `部首「${RAD_CHAR(n)}${RAD_ALT[n] ? '・' + RAD_ALT[n] : ''}」の漢字`, list, showStroke: true }]);
  window.scrollTo(0, 0);
}

// ===== 手書き =====
let HW = null;          // [{c, n, f: Float32Array}]
let pad, ctx, userStrokes = [], cur = null;

async function initPad() {
  if (!pad) {
    pad = $('#pad'); ctx = pad.getContext('2d');
    const resize = () => {
      const r = pad.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      pad.width = r.width * dpr; pad.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    new ResizeObserver(resize).observe(pad);
    const pos = (ev) => { const r = pad.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    pad.addEventListener('pointerdown', (ev) => { pad.setPointerCapture(ev.pointerId); cur = [pos(ev)]; redraw(); });
    pad.addEventListener('pointermove', (ev) => { if (!cur) return; cur.push(pos(ev)); redraw(); });
    const end = () => { if (!cur) return; if (cur.length === 1) cur.push([cur[0][0] + 0.5, cur[0][1] + 0.5]); userStrokes.push(cur); cur = null; redraw(); recognize(); };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    $('#hw-undo').onclick = () => { userStrokes.pop(); redraw(); recognize(); };
    $('#hw-clear').onclick = () => { userStrokes = []; redraw(); recognize(); };
    $('#hw-bs').onclick = () => setQuery([...$('#q').value].slice(0, -1).join(''));
  }
  if (!HW) {
    $('#hw-cands').innerHTML = '<span class="muted">手書きデータを読み込み中…</span>';
    const raw = await fetch('data/hw.json').then((r) => r.json());
    const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
    const map = {}; [...A].forEach((ch, i) => (map[ch] = i));
    HW = raw.map(([c, s]) => {
      const f = new Float32Array(s.length);
      for (let i = 0; i < s.length; i++) f[i] = map[s[i]];
      return { c, n: s.length / 8, f };
    });
    recognize();
  }
}

function redraw() {
  if (!ctx) return;
  const w = pad.clientWidth, h = pad.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const cs = getComputedStyle(document.documentElement);
  ctx.strokeStyle = cs.getPropertyValue('--guide'); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = cs.getPropertyValue('--ink'); ctx.lineWidth = Math.max(4, w / 45); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of cur ? [...userStrokes, cur] : userStrokes) {
    ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]);
    for (const p of s) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
}

// 各画を弧長で4点に等分 → 全体の外接枠で正規化(縦横比維持)して 0-63 に
function userFeatures(strokes) {
  const rs = strokes.map((s) => {
    const cum = [0];
    for (let k = 1; k < s.length; k++) cum.push(cum[k - 1] + Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]));
    const L = cum[cum.length - 1], out = [];
    for (let j = 0; j < 4; j++) {
      const t = L * j / 3; let k = 1;
      while (k < s.length - 1 && cum[k] < t) k++;
      const seg = cum[k] - cum[k - 1] || 1, u = Math.min(1, Math.max(0, (t - cum[k - 1]) / seg));
      out.push([s[k - 1][0] + (s[k][0] - s[k - 1][0]) * u, s[k - 1][1] + (s[k][1] - s[k - 1][1]) * u]);
    }
    return out;
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const [x, y] of s) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const size = Math.max(maxX - minX, maxY - minY, 1), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const f = new Float32Array(strokes.length * 8);
  rs.forEach((s, i) => s.forEach(([x, y], j) => { f[i * 8 + j * 2] = ((x - cx) / size + 0.5) * 63; f[i * 8 + j * 2 + 1] = ((y - cy) / size + 0.5) * 63; }));
  return f;
}

// 画の対応づけを DP で(画の過不足・逆向きも少し許す)
function strokeDist(a, i, b, j) {
  let fwd = 0, rev = 0;
  for (let k = 0; k < 4; k++) {
    fwd += Math.hypot(a[i * 8 + k * 2] - b[j * 8 + k * 2], a[i * 8 + k * 2 + 1] - b[j * 8 + k * 2 + 1]);
    rev += Math.hypot(a[i * 8 + k * 2] - b[j * 8 + (3 - k) * 2], a[i * 8 + k * 2 + 1] - b[j * 8 + (3 - k) * 2 + 1]);
  }
  return Math.min(fwd, rev + 25);
}
function recognize() {
  const box = $('#hw-cands');
  if (!HW) return;
  if (!userStrokes.length) { box.innerHTML = '<span class="muted">枠に1字ずつ書いて候補をタップ → 検索欄に入ります。続けて書けば熟語も探せます</span>'; return; }
  const u = userFeatures(userStrokes), n = userStrokes.length, G = 70;
  const res = [];
  const dp = new Float32Array((n + 1) * 40);
  for (const t of HW) {
    const m = t.n;
    if (m < n - 2 || m > n + 2 || m > 38) continue;
    const W = m + 1;
    for (let j = 0; j <= m; j++) dp[j] = j * G;
    for (let i = 1; i <= n; i++) {
      dp[i * W] = i * G;
      for (let j = 1; j <= m; j++) {
        dp[i * W + j] = Math.min(dp[(i - 1) * W + j - 1] + strokeDist(u, i - 1, t.f, j - 1), dp[(i - 1) * W + j] + G, dp[i * W + j - 1] + G);
      }
    }
    const e = K[t.c];
    res.push([t.c, dp[n * W + m] / Math.max(n, m) + (e.g && e.g <= 8 ? 0 : 3)]);
  }
  res.sort((a, b) => a[1] - b[1]);
  box.textContent = '';
  // 候補をタップ → 検索欄の末尾に追加して、次の字を書けるように枠を消す
  res.slice(0, 15).forEach(([c]) => box.append(el('button', { onclick: () => { setQuery($('#q').value + c); userStrokes = []; redraw(); recognize(); } }, c)));
}

// ===== その他 =====
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1600);
}

window.addEventListener('popstate', (ev) => {
  if (ev.state?.k) openDetail(ev.state.k, false);
  else if (ev.state?.w != null) openWord(ev.state.w, false);
  else hideDetail();
});

async function main() {
  $('#results').innerHTML = '<p class="empty">読み込み中…</p>';
  [K, RAD] = await Promise.all([fetch('data/kanji.json').then((r) => r.json()), fetch('data/radicals.json').then((r) => r.json())]);
  KEYS = Object.keys(K);
  $('#q').addEventListener('input', onInput);
  $('#q').addEventListener('compositionend', onInput);
  $('#q').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('#q').blur(); });
  $('#clear').onclick = () => { setQuery(''); $('#q').focus(); };
  $('#btn-hw').onclick = () => setMode('hw');
  $('#btn-rad').onclick = () => setMode('rad');
  $('#back').onclick = closeDetail;
  renderSections(null);
  const m = location.hash.match(/^#k=(.+)$/);
  if (m) { const c = decodeURIComponent(m[1]); history.replaceState({ k: c }, '', location.hash); openDetail(c, false); }
  const mw = location.hash.match(/^#w=(d+)$/);
  if (mw) { history.replaceState({ w: +mw[1] }, '', location.hash); openWord(+mw[1], false); }
  // 熟語データは裏で読み込み、届いたら今の表示を更新
  loadWords().then(() => {
    if (view === 'home') renderSections(null);
    else if ($('#q').value) renderSections(search($('#q').value));
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
main();
