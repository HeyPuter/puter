<h3 align="center"><img width="80" alt="Puter.com, Den Personlige Cloudcomputer: Alle dine filer, apps og spil på ét sted tilgængelige fra hvor som helst til enhver tid." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Internet OS'et! Gratis, Open-Source og kan selvhostes.</h3>

<p align="center">
    <img alt="GitHub repo størrelse" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Udgivelse" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub Licens" src="https://img.shields.io/github/license/HeyPuter/puter">
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="skærmbillede" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter er et avanceret, open-source internetoperativsystem designet til at være funktionsrigt, exceptionelt hurtigt og meget udvideligt. Puter kan bruges som:

- En privatlivsfokuseret personlig sky til at opbevare alle dine filer, apps og spil på ét sikkert sted, tilgængeligt hvor som helst og når som helst.
- En platform til at bygge og publicere hjemmesider, webapplikationer og spil.
- Et alternativ til Dropbox, Google Drive, OneDrive osv. med et friskt interface og kraftfulde funktioner.
- Et fjernskrivebordsmiljø for servere og arbejdsstationer.
- Et venligt, open-source projekt og fællesskab til at lære om webudvikling, cloud computing, distribuerede systemer og meget mere!

<br/>

## Kom godt i gang


### 💻 Lokal Udvikling

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Dette vil starte Puter på http://puter.localhost:4100 (eller den næste tilgængelige port).

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

Puter er tilgængelig som en hosted tjeneste på [**puter.com**](https://puter.com).

<br/>

## Systemkrav

- **Operativsystemer:** Linux, macOS, Windows
- **RAM:** 2GB minimum (4GB anbefales)
- **Diskplads:** 1GB fri plads
- **Node.js:** Version 16+ (Version 22+ anbefales)
- **npm:** Seneste stabile version

<br/>

## Support

Kom i kontakt med vedligeholderne og fællesskabet gennem disse kanaler:

- Bugrapport eller funktionønske? Åbn [venligst en sag](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Sikkerhedsspørgsmål? [security@puter.com](mailto:security@puter.com)
- Send email til vedligeholdere på [hi@puter.com](mailto:hi@puter.com)

Vi er altid glade for at hjælpe dig med eventuelle spørgsmål, du måtte have. Tøv ikke med at spørge!

<br/>


## Licens

Dette repository, inklusive alt dets indhold, underprojekter, moduler og komponenter, er licenseret under [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), medmindre andet er udtrykkeligt angivet. Tredjepartsbiblioteker inkluderet i dette repository kan være underlagt deres egne licenser.

<br/>
