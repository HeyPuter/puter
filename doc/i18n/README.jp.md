
<h3 align="center"><img width="80" alt="Puter.com, あなたのファイル、アプリ、ゲームをどこからでもアクセス可能にするパーソナルクラウドコンピュータ" src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">インターネットOS！無料、オープンソース、セルフホスト可能。</h3>

<p align="center">
    <img alt="GitHub リポジトリサイズ" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub リリース" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=%E6%9C%80%E6%96%B0%E3%83%90%E3%83%BC%E3%82%B8%E3%83%A7%E3%83%B3"> <img alt="GitHub ライセンス" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« ライブデモ »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">SDK</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://www.youtube.com/@EricsPuterVideos">YouTube</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (Twitter)</a>
    ·
    <a href="https://hackerone.com/puter_h1b">バグバウンティ</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="スクリーンショット" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puterは、機能豊富で非常に高速、そして高い拡張性を持つ、先進的なオープンソースのインターネットオペレーティングシステムです。Puterは以下の用途に利用できます：

- プライバシーを最優先するパーソナルクラウドとして、あなたのファイル、アプリ、ゲームを一か所で安全に管理し、どこからでもアクセス可能に。
- ウェブサイト、ウェブアプリ、ゲームの作成と公開のためのプラットフォーム。
- Dropbox、Google Drive、OneDriveなどの代替として、新しいインターフェースと強力な機能を提供。
- サーバーやワークステーションのためのリモートデスクトップ環境。
- ウェブ開発、クラウドコンピューティング、分散システムなどを学ぶための、フレンドリーでオープンなコミュニティとプロジェクト。

<br/>

## はじめに


### 💻 ローカル開発

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

これでPuterが http://puter.localhost:4100 （または次に利用可能なポート）で起動します。

<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

### 🐙 Docker Compose

#### Linux/macOS
```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```
<br/>

#### Windows

```powershell
mkdir -p puter
cd puter
New-Item -Path "puter\config" -ItemType Directory -Force
New-Item -Path "puter\data" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml" -OutFile "docker-compose.yml"
docker compose up
```
<br/>

### ☁️ Puter.com

Puterは[**puter.com**](https://puter.com)でホストサービスとして利用可能です。

<br/>

## システム要件

- **オペレーティングシステム:** Linux, macOS, Windows
- **RAM:** 最小2GB（推奨4GB）
- **ディスクスペース:** 1GBの空き容量
- **Node.js:** バージョン16以上（推奨バージョン22以上）
- **npm:** 最新の安定バージョン

<br/>

## サポート

メンテナーやコミュニティと以下のチャンネルを通じてつながりましょう：

- バグ報告や機能リクエストがありますか？ [issueを開く](https://github.com/HeyPuter/puter/issues/new/choose) してください。
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- セキュリティの問題？ [security@puter.com](mailto:security@puter.com)
- メンテナーへのメールは [hi@puter.com](mailto:hi@puter.com) まで

質問があれば、いつでもお気軽にお問い合わせください！

<br/>

## ライセンス

このリポジトリ、ならびにそのすべてのコンテンツ、サブプロジェクト、モジュール、コンポーネントは、[AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt)の下でライセンスされています。明示的に異なるライセンスが示されている場合を除きます。このリポジトリに含まれるサードパーティのライブラリは、それぞれのライセンスが適用される場合があります。

<br/>
