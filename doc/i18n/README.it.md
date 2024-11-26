<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Il sistema operativo di Internet! Gratuito, Open-Source e Auto-Hostabile.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
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

Puter è un sistema operativo di Internet avanzato e open-source, progettato per essere ricco di funzionalità, eccezionalmente veloce e altamente estensibile. Puter può essere utilizzato come:

- Un cloud personale che tiene conto della privacy per conservare tutti i file, le app e i giochi in un luogo sicuro, accessibile da qualsiasi luogo e in qualsiasi momento.
- Una piattaforma per creare e pubblicare siti web, app e giochi.
- Un'alternativa a Dropbox, Google Drive, OneDrive, ecc. con un'interfaccia nuova e funzioni potenti. 
- Un ambiente desktop remoto per server e workstation. 
- Un progetto e una comunità open-source amichevole per imparare lo sviluppo web, il cloud computing, i sistemi distribuiti e molto altro ancora!

<br/>

## Getting Started


### 💻 Local Development

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

In questo modo Puter verrà avviato all'indirizzo http://puter.localhost:4100 (o alla prossima porta disponibile).

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

Puter è disponibile come servizio in hosting su [**puter.com**](https://puter.com).

<br/>

## Requisiti di Sistema

- **Sistema Operativo:** Linux, macOS, Windows
- **RAM:** 2GB minimi (4GB raccomandati)
- **Spazio su Disco:** 1GB liberi
- **Node.js:** Versione 16+ (Versione 22+ raccomandati)
- **npm:** Ultima versione stabile

<br/>

## Supporto

Collegatevi con i maintainers e la comunità attraverso questi canali:

- Segnalazione di bug o richiesta di funzionalità? Perfavore [aprire una issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Problemi di sicurezza? [security@puter.com](mailto:security@puter.com)
- Email maintainers a [hi@puter.com](mailto:hi@puter.com)

Siamo sempre felici di aiutarvi con qualsiasi domanda. Non esitate a chiedere!

<br/>


##  Licenza

Questo repository, compresi tutti i suoi contenuti, sottoprogetti, moduli e componenti, è concesso in licenza [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), a meno che non sia esplicitamente indicato diversamente. Le librerie di terze parti incluse in questo repository possono essere soggette alle loro licenze.

<br/>

