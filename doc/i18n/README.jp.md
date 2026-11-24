<h3 align="center"><img width="80" alt="Puter.com、パーソナルクラウドコンピューター：ファイル、アプリ、ゲームのすべてを一か所に集約し、いつでもどこからでもアクセスできます。" src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">オープンソースのインターネットコンピューター！</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« ライブデモ »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://office.puter.com/">Office Suite</a>
    ·
    <a href="https://builder.puter.com/">AI Builder</a>
    ·
    <a href="https://developer.puter.com" target="_blank">開発者</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="スクリーンショット" src="https://assets.puter.com/puter-screenshot.webp"></h3>

<br/>

## Puter

Puterは、機能が豊富で高速、かつ高い拡張性を備えた、先進的なオープンソースのセルフホスト可能なインターネットコンピューターです。

### ユーザーの方へ
Puterの目標は、仕事、創作、遊びに必要なものをすべて一つの場所で提供することです。シンプルな[Notepad](https://online-notepad.com)や[Camera](https://online-camera.com)から[Office Suite](https://office.puter.com)や[AI Builder](https://builder.puter.com)まで、Puterはあなたのデジタルライフのオールインワンソリューションを目指しています。


### 開発者の方へ

Puterは、Webアプリやゲームの構築と公開に必要なものをすべて提供します。[AI](https://developer.puter.com/ai/)から[クラウドストレージ](https://developer.puter.com/object-storage/)、[データベース](https://developer.puter.com/key-value-database/)、[サーバーレスワーカー](https://developer.puter.com/serverless-workers/)まで、Puterにおまかせください。Puterはユーザーの獲得もサポートします。アプリを作ったら、[App Store](https://apps.puter.com/)で公開して、ユーザーに届け、収益化できます。

<br/>

## はじめに


### 💻 ローカル開発

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** Puterが http://puter.localhost:4100 で起動するはずです

Dockerでこのチェックアウトを実行するには、[ソースからのビルド](../self-hosting.md#building-from-source-instead-of-pulling)に従ってください。ローカルビルドを選択するには、ローカルに`docker-compose.override.yml`を作成します。これらの設定を`docker-compose.yml`に含めないことで、更新を取り込む際の競合を避け、ローカル設定がプルリクエストに混入するのを防げます。


<br/>

### 🚀 セルフホスティング

#### Linux/macOS

```bash
curl -fsSL https://puter.com/selfhost | sh
```

#### Windows

```powershell
irm https://puter.com/selfhost?os=windows | iex
```

**→** 詳細は[Puterのセルフホスティング](../self-hosting.md)をご覧ください。

<br/>

### ☁️ Puter.com

Puterは[**puter.com**](https://puter.com)でホスティングサービスとして利用できます。

<br/>

## サポート

メンテナーやコミュニティとは、次のチャネルでつながれます。

- バグ報告や機能リクエストは、[Issueを作成](https://github.com/HeyPuter/puter/issues/new/choose)してください。
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- セキュリティの問題や不正利用の報告は[security@puter.com](mailto:security@puter.com)まで。
- メンテナーへのメールは[hi@puter.com](mailto:hi@puter.com)まで

ご質問があれば、いつでもお気軽にどうぞ。喜んでお手伝いします！

<br/>

## ライセンス

このリポジトリは、そのすべての内容、サブプロジェクト、モジュール、コンポーネントを含め、特に明記されている場合を除き、[AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt)の下でライセンスされています。このリポジトリに含まれるサードパーティライブラリには、それぞれ独自のライセンスが適用される場合があります。

<br/>

## 翻訳

- [Arabic / العربية](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ar.md)
- [Armenian / Հայերեն](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hy.md)
- [Bengali / বাংলা](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.bn.md)
- [Chinese / 中文](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.zh.md)
- [Danish / Dansk](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.da.md)
- [English](https://github.com/HeyPuter/puter/blob/main/README.md)
- [Farsi / فارسی](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fa.md)
- [Finnish / Suomi](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fi.md)
- [French / Français](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fr.md)
- [German /  Deutsch](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.de.md)
- [Hebrew/ עברית](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.he.md)
- [Hindi / हिंदी](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md)
- [Hungarian / Magyar](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hu.md)
- [Indonesian / Bahasa Indonesia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.id.md)
- [Italian / Italiano](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.it.md)
- [Japanese / 日本語](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md)
- [Korean / 한국어](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ko.md)
- [Malay / Bahasa Malaysia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.my.md)
- [Malayalam / മലയാളം](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ml.md)
- [Dutch / Nederlands](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.nl.md)
- [Polish / Polski](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pl.md)
- [Odia / ଓଡ଼ିଆ](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.od.md)
- [Portuguese / Português](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md)
- [Punjabi / ਪੰਜਾਬੀ](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pa.md)
- [Romanian / Română](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ro.md)
- [Russian / Русский](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ru.md)
- [Spanish / Español](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.es.md)
- [Swedish / Svenska](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.sv.md)
- [Tamil / தமிழ்](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ta.md)
- [Telugu / తెలుగు](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.te.md)
- [Thai / ไทย](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.th.md)
- [Turkish / Türkçe](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.tr.md)
- [Ukrainian / Українська](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ua.md)
- [Urdu / اردو](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ur.md)
- [Vietnamese / Tiếng Việt](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.vi.md)
