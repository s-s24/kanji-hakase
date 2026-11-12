# 漢字辞典

スマホ向けの漢字辞典 Web アプリ（PWA）。ホーム画面に追加するとアプリのように使え、オフラインでも動きます。

## できること

- **熟語の意味**：`海岸` `かいがん` → 読みと日本語の意味（約6.3万語）
- **キーボード検索**
  - 読み：`うみ` `カイ`
  - パーツ：`氵` `木口`（その部品を含む漢字）
  - パーツ＋読み：`木 ま`
  - 画数：`12` `12画`
- **手書き入力**（オフラインで認識。1字ずつ検索欄に入るので、続けて書けば熟語も探せます）
- **部首一覧**（康熙部首 214）
- **漢字の詳細**：音読み・訓読み・名乗り、画数、部首、学年、使用頻度、筆順アニメ、筆順一覧、この字を使う熟語
- お気に入り・履歴、ダークモード

収録 13,033 字（うち筆順・手書き対応 6,417 字）、熟語 62,984 語（うち日本語の意味あり 61,395 語）。

## 構成

```
app/            公開するアプリ本体（このフォルダをそのまま配信）
  data/         生成データ（kanji.json, radicals.json, hw.json, strokes/*.json, words.json, wdef/*.json）
tools/build.js        KANJIDIC2・KanjiVG → 漢字データを生成
tools/build-words.js  JMdict・ウィクショナリー → 熟語データを生成
tools/serve.js  確認用ローカルサーバー（http://localhost:8130）
```

## データの作り直し

元データは容量が大きいためリポジトリに含めていません。`raw/` に置いてから生成します。

```bash
mkdir -p raw/kanjidic raw/kanjivg
curl -L -o raw/kanjidic/kanjidic2.xml.gz https://www.edrdg.org/kanjidic/kanjidic2.xml.gz
curl -L -o raw/kanjivg/kanjivg.xml.gz https://github.com/KanjiVG/kanjivg/releases/download/r20260714/kanjivg-20260714.xml.gz
node tools/build.js

# 熟語(ウィクショナリーは約95MB、展開後約700MB)
mkdir -p raw/jmdict raw/wiktionary
curl -L -o raw/jmdict/JMdict_e.gz http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
curl -L -o raw/wiktionary/jawiktionary.xml.bz2 https://dumps.wikimedia.org/jawiktionary/latest/jawiktionary-latest-pages-articles.xml.bz2
bzip2 -dk raw/wiktionary/jawiktionary.xml.bz2
node --max-old-space-size=4096 tools/build-words.js
```

## ローカルで確認

```bash
node tools/serve.js
```

## ライセンス・出典

- 漢字データ：[KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)（Electronic Dictionary Research and Development Group, CC BY-SA 4.0）
- 筆順データ：[KanjiVG](https://kanjivg.tagaini.net)（Ulrich Apel, CC BY-SA 3.0）
- 熟語・読み：[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html)（EDRDG, CC BY-SA 4.0）
- 熟語の意味：[ウィクショナリー日本語版](https://ja.wiktionary.org/)（CC BY-SA 4.0）

`app/data/` 以下はこれらから生成した派生データのため、同じ CC BY-SA の条件で配布されます。
