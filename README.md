# 漢字辞典

スマホ向けの漢字辞典 Web アプリ（PWA）。ホーム画面に追加するとアプリのように使え、オフラインでも動きます。

## できること

- **キーボード検索**
  - 読み：`うみ` `カイ`
  - パーツ：`氵` `木口`（その部品を含む漢字）
  - パーツ＋読み：`木 ま`
  - 画数：`12` `12画`
- **手書き入力**（オフラインで認識。書き順どおりだと精度が上がります）
- **部首一覧**（康熙部首 214）
- **詳細**：音読み・訓読み・名乗り、画数、部首、学年、使用頻度、筆順アニメ、筆順一覧
- お気に入り・履歴、ダークモード

収録 13,033 字（うち筆順・手書き対応 6,417 字）。

## 構成

```
app/            公開するアプリ本体（このフォルダをそのまま配信）
  data/         生成データ（kanji.json, radicals.json, hw.json, strokes/*.json）
tools/build.js  元データ → app/data を生成
tools/serve.js  確認用ローカルサーバー（http://localhost:8130）
```

## データの作り直し

元データは容量が大きいためリポジトリに含めていません。`raw/` に置いてから生成します。

```bash
mkdir -p raw/kanjidic raw/kanjivg
curl -L -o raw/kanjidic/kanjidic2.xml.gz https://www.edrdg.org/kanjidic/kanjidic2.xml.gz
curl -L -o raw/kanjivg/kanjivg.xml.gz https://github.com/KanjiVG/kanjivg/releases/download/r20260714/kanjivg-20260714.xml.gz
node tools/build.js
```

## ローカルで確認

```bash
node tools/serve.js
```

## ライセンス・出典

- 漢字データ：[KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)（Electronic Dictionary Research and Development Group, CC BY-SA 4.0）
- 筆順データ：[KanjiVG](https://kanjivg.tagaini.net)（Ulrich Apel, CC BY-SA 3.0）

`app/data/` 以下はこれらから生成した派生データのため、同じ CC BY-SA の条件で配布されます。
