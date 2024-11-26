<h3 align="center"><img width="80" alt="Puter.com, De Persoonlijke Cloud Computer: Al je bestanden, apps en games op één plek, overal en altijd toegankelijk." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Het Internet OS! Gratis, Open-Source en Zelf te Hosten.</h3>

<p align="center">
    <img alt="GitHub repo grootte" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=laatste%20versie"> <img alt="GitHub Licentie" src="https://img.shields.io/github/license/HeyPuter/puter">
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter is een geavanceerd, open-source internetbesturingssysteem ontworpen om functierijk, uitzonderlijk snel en zeer uitbreidbaar te zijn. Puter kan worden gebruikt als:

- Een privacy-gerichte persoonlijke cloud om al je bestanden, apps en games op één veilige plek te bewaren, overal en altijd toegankelijk.
- Een platform voor het bouwen en publiceren van websites, web-apps en games.
- Een alternatief voor Dropbox, Google Drive, OneDrive, etc. met een frisse interface en krachtige functies.
- Een externe desktopomgeving voor servers en werkstations.
- Een vriendelijk, open-source project en gemeenschap om te leren over webontwikkeling, cloud computing, gedistribueerde systemen en veel meer!

<br/>

## Aan de slag


### 💻 Lokale Ontwikkeling

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Dit zal Puter starten op http://puter.localhost:4100 (of de eerstvolgende beschikbare poort).

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

Puter is beschikbaar als een gehoste service op [**puter.com**](https://puter.com).

<br/>

## Systeemvereisten

- **Besturingssystemen:** Linux, macOS, Windows
- **RAM:** 2GB minimum (4GB aanbevolen)
- **Schijfruimte:** 1GB vrije ruimte
- **Node.js:** Versie 16+ (Versie 22+ aanbevolen)
- **npm:** Laatste stabiele versie

<br/>

## Ondersteuning

Verbind met de onderhouders en de gemeenschap via deze kanalen:

- Bug rapport of functieverzoek? [Open een issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Beveiligingsproblemen? [security@puter.com](mailto:security@puter.com)
- E-mail onderhouders op [hi@puter.com](mailto:hi@puter.com)

We helpen je graag met al je vragen. Aarzel niet om te vragen!

<br/>


## Licentie

Deze repository, inclusief alle inhoud, subprojecten, modules en componenten, is gelicentieerd onder [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) tenzij expliciet anders vermeld. Bibliotheken van derden die in deze repository zijn opgenomen, kunnen onderworpen zijn aan hun eigen licenties.

<br/>