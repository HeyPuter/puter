<h3 align="center"><img width="80" alt="Puter.com, Den personliga molndatorn: Alla dina filer, appar och spel på ett ställe tillgängliga var som helst när som helst." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Internet OS! Gratis, öppen källkod och självhostad.</h3>

<p align="center">
    <img alt="GitHub repo storlek" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Utgåva" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=senaste%20versionen"> <img alt="GitHub Licens" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« LIVE DEMO »</strong></a>
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="skärmdump" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter är ett avancerat, öppen källkod internetoperativsystem designat för att vara funktionsrikt, exceptionellt snabbt och mycket utbyggbart. Puter kan användas som:

- Ett integritetsfokuserat personligt moln för att hålla alla dina filer, appar och spel på ett säkert ställe, tillgängligt var som helst när som helst.
- En plattform för att bygga och publicera webbplatser, webbappar och spel.
- Ett alternativ till Dropbox, Google Drive, OneDrive, etc. med ett fräscht gränssnitt och kraftfulla funktioner.
- En fjärrskrivbordsmiljö för servrar och arbetsstationer.
- Ett vänligt, öppen källkod-projekt och gemenskap för att lära sig om webbutveckling, molndatorer, distribuerade system och mycket mer!

<br/>

## Komma igång

### 💻 Lokal Utveckling

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Detta kommer att starta Puter på http://puter.localhost:4100 (eller nästa lediga port).

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

Puter är tillgängligt som en värdtjänst på [**puter.com**](https://puter.com).

<br/>

## Systemkrav

- **Operating Systems:** Linux, macOS, Windows
- **RAM:** 2GB minimum (4GB recommended)
- **Disk Space:** 1GB free space
- **Node.js:** Version 16+ (Version 22+ recommended)
- **npm:** Latest stable version

<br/>

## Support

Anslut med underhållarna och gemenskapen genom dessa kanaler:

- Buggrapport eller funktionsförfrågan? Vänligen [öppna ett ärende](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Säkerhetsproblem? [security@puter.com](mailto:security@puter.com)
- E-posta underhållarna på [hi@puter.com](mailto:hi@puter.com)

Vi hjälper dig gärna med eventuella frågor du kan ha. Tveka inte att fråga!

<br/>

## Licens

Detta arkiv, inklusive allt dess innehåll, delprojekt, moduler och komponenter, är licensierat under [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) om inte annat uttryckligen anges. Tredjepartsbibliotek som ingår i detta arkiv kan vara föremål för sina egna licenser.

<br/>
