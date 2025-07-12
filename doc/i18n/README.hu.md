<h3 align="center"><img width="80" alt="Puter.com, A személyi felhő számítógép:  Minden fájl, alkalmazás és játék egy helyen elérhető bárhonnan, bármikor." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Az internetes oprendszer! Ingyenes, nyílt-forráskódú, saját szerveren futtatható.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« ÉLŐ DEMO »</strong></a>
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

A Puter egy fejlett, nyílt forráskódú internetes operációs rendszer, amelyet úgy terveztek, hogy funkciókban gazdag, kivételesen gyors és nagymértékben bővíthető legyen. A Puter a következőképpen használható:

- Egy adatvédelmet előtérbe helyező személyes felhő, amely minden fájlt, alkalmazást és játékot egy biztonságos helyen tart. Bárhonnan és bármikor elérhető.
- Egy platform weboldalak, web-appok, és játékok készítéséhez/közzétételéhez.
- A Dropbox, Google Drive, OneDrive (stb.) alternatívája megújult felülettel és hatékony funkciókkal.
- Egy távoli desktop-környezet szervereknek és workstation-öknek.
- Egy barátságos, nyílt forráskódú projekt és közösség, amely a webfejlesztéssel, a felhőalapú számítástechnikával, elosztott rendszerekkel és sok más érdekes témával foglalkozik!

<br/>

## Első lépések

### 💻 Helyi (lokális) fejlesztés

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Ezzel a http://puter.localhost:4100 -on futtatjuk Putert. (vagy a legközelebbi elérhető porton).

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

A Puter elérhető hostolt szolgáltatásként a [**puter.com**](https://puter.com) címen.

<br/>

## Rendszerkövetelmények

- **Operációs rendszerek:** Linux, macOS, Windows
- **RAM:** 2GB minimum (4GB ajánlott)
- **Tárhely:** 1GB szabad tárhely
- **Node.js:** 16+ (22+ verzió ajánlott)
- **npm:** legújabb stabil verzió

<br/>

## Támogatás

Lépj kapcsolatba a fejlesztőkkel és a közösséggel az alábbi platformokon:

- Észrevételeid/javaslataid vannak? Az [alábbi linken](https://github.com/HeyPuter/puter/issues/new/choose) megoszthatod velünk.
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Biztonsági hibák? [security@puter.com](mailto:security@puter.com)
- A fejlesztőket a [hi@puter.com](mailto:hi@puter.com) email címen érheted el.

Mindig örömmel segítünk bármilyen felmerülő kérdésben. Bátran kérdezz tőlünk!

<br/>

## License

Ez a repo, beleértve annak minden tartalmát, alprojektjeit, moduljait és komponenseit, az [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) licenc alatt áll, hacsak másképp nem rendelkeznek róla. A repoban szereplő harmadik fél által fejlesztett könyvtárak saját licencfeltételek alá eshetnek.

<br/>
