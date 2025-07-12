<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Puter: 인터넷 OS! 무료이고 오픈소스이며 자체 호스팅이 가능합니다.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« 시연 영상 »</strong></a>
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

Puter는 오픈소스 인터넷 운영 체제로, 매우 빠르고 확장성이 뛰어나며 새로운 인터페이스와 다양한 기능을 갖추고 있습니다. Puter는 다음과 같이 사용될 수 있습니다:

- 모든 파일, 앱, 게임을 한 곳에 안전하게 보관하고 언제 어디서나 접근할 수 있는 프라이버시 중심의 개인 클라우드로 사용할 수 있습니다.
- 웹사이트, 웹 앱, 게임을 구축하고 배포하는 플랫폼으로 활용할 수 있습니다.
- Dropbox, Google Drive, OneDrive 등의 대안으로 사용할 수 있으며 보다 발전된 기능과 인터페이스를 제공합니다.
- 서버와 워크스테이션을 위한 원격 데스크톱 환경으로 활용할 수 있습니다.
- 웹 개발, 클라우드 컴퓨팅, 분산 시스템 등에 대해 배울 수 있는 친근한 오픈소스 프로젝트이자 커뮤니티입니다!

<br/>

## 시작하기

### 💻 로컬 환경 개발

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

위처럼 실행할 시 Puter는 http://puter.localhost:4100 (또는 사용 가능한 다음 포트)에서 실행됩니다.

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

Puter는 [**puter.com**](https://puter.com)에서 호스팅 서비스로 이용할 수 있습니다.

<br/>

## 시스템 요구사항

- **Operating Systems:** Linux, macOS, Windows
- **RAM:** 2GB minimum (4GB recommended)
- **Disk Space:** 1GB free space
- **Node.js:** Version 16+ (Version 22+ recommended)
- **npm:** Latest stable version

<br/>

## 지원

다음 채널을 통해 관리자 및 커뮤니티와 소통하세요:

- 버그 신고나 기능 요청이 있으신가요? [이슈를 열어주세요.](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- 보안 관련 문제는 [security@puter.com](mailto:security@puter.com) 으로 연락주세요.
- 관리자에게 이메일 보내기: [hi@puter.com](mailto:hi@puter.com)

어떤 질문이든 기꺼이 도와드리겠습니다. 언제든 물어보세요!

<br/>

## 라이선스

이 저장소는 모든 내용, 하위 프로젝트, 모듈 및 구성 요소를 포함하여 명시적으로 달리 명시되지 않는 한 [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) 라이선스 하에 제공됩니다. 이 저장소에 포함된 제3자 라이브러리는 해당 라이브러리의 고유 라이선스를 따를 수 있습니다.

<br/>
