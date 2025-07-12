<h3 align="center"><img width="80" alt="Puter.com，个人云计算机：所有文件、应用程序和游戏在一个地方，随时随地可访问。" src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">互联网操作系统！免费、开源且可自行托管。</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>

<p align="center">
    <a href="https://puter.com/"><strong>« 在线演示 »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">SDK</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (Twitter)</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter 是一个先进的开源互联网操作系统，设计为功能丰富、速度极快且高度可扩展。Puter 可用作：

- 一个以隐私为优先的个人云，将所有文件、应用程序和游戏保存在一个安全的地方，随时随地可访问。
- 构建和发布网站、Web 应用程序和游戏的平台。
- Dropbox、Google Drive、OneDrive 等的替代品，具有全新的界面和强大的功能。
- 服务器和工作站的远程桌面环境。
- 一个友好的开源项目和社区，学习 Web 开发、云计算、分布式系统等更多内容！

<br/>

## 入门指南

### 💻 本地开发

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

这将会在 http://puter.localhost:4100（或下一个可用端口）启动 Puter。

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

## 宝塔面板Docker一键部署（推荐）

1. 安装宝塔面板9.2.0及以上版本，前往 [宝塔面板](https://www.bt.cn/new/download.html?r=dk_puter) 官网，选择正式版的脚本下载安装

2. 安装后登录宝塔面板，在左侧菜单栏中点击 `Docker`，首次进入会提示安装`Docker`服务，点击立即安装，按提示完成安装

3. 安装完成后在应用商店中搜索`puter`，点击安装，配置域名等基本信息即可完成安装

### ☁️ Puter.com

Puter 可以作为托管服务使用，访问 [**puter.com**](https://puter.com)。

<br/>

## 系统要求

- **操作系统：** Linux, macOS, Windows
- **内存：** 最低 2GB（推荐 4GB）
- **磁盘空间：** 1GB 可用空间
- **Node.js：** 版本 16+（推荐 22+）
- **npm：** 最新稳定版本

<br/>

## 支持

通过以下渠道与维护者和社区联系：

- 有 Bug 报告或功能请求？请 [提交问题](https://github.com/HeyPuter/puter/issues/new/choose)。
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- 安全问题？请联系 [security@puter.com](mailto:security@puter.com)
- 电子邮件维护者 [hi@puter.com](mailto:hi@puter.com)

我们随时乐意帮助您解答任何问题，欢迎随时联系！

<br/>

## 许可证

本仓库，包括其所有内容、子项目、模块和组件，除非另有明确说明，否则均遵循 [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) 许可证。 本仓库中包含的第三方库可能受其各自的许可证约束。

<br/>
