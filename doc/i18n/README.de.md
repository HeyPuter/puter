<h3 align="center"><img width="80" alt="Puter.com, Der persönliche Cloud-Computer: Alle Ihre Dateien, Apps und Spiele an einem Ort, jederzeit und überall zugänglich." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Das Internet-Betriebssystem! Kostenlos, Open-Source und selbst hostbar.</h3>

<p align="center">
    <img alt="GitHub Repo-Größe" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Veröffentlichung" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=neueste%20Version"> <img alt="GitHub Lizenz" src="https://img.shields.io/github/license/HeyPuter/puter">
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="Bildschirmfoto" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter ist ein fortschrittliches, Open-Source-Internet-Betriebssystem, das funktionsreich, außergewöhnlich schnell und hochgradig erweiterbar konzipiert wurde. Puter kann verwendet werden als:

- Eine datenschutzfreundliche persönliche Cloud, um alle Ihre Dateien, Apps und Spiele an einem sicheren Ort aufzubewahren, jederzeit und überall zugänglich.
- Eine Plattform zum Erstellen und Veröffentlichen von Websites, Webanwendungen und Spielen.
- Eine Alternative zu Dropbox, Google Drive, OneDrive usw. mit einer frischen Benutzeroberfläche und leistungsstarken Funktionen.
- Eine Remote-Desktop-Umgebung für Server und Workstations.
- Ein freundliches, Open-Source-Projekt und eine Community, um mehr über Webentwicklung, Cloud Computing, verteilte Systeme und vieles mehr zu lernen!

<br/>

## Erste Schritte


### 💻 Lokale Entwicklung

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Dies startet Puter unter http://puter.localhost:4100 (oder dem nächsten verfügbaren Port).

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

Puter ist als gehosteter Dienst unter [**puter.com**](https://puter.com) verfügbar.

<br/>

## Systemanforderungen

- **Betriebssysteme:** Linux, macOS, Windows
- **RAM:** Mindestens 2GB (4GB empfohlen)
- **Festplattenspeicher:** 1GB freier Speicherplatz
- **Node.js:** Version 16+ (Version 22+ empfohlen)
- **npm:** Neueste stabile Version

<br/>

## Unterstützung

Verbinden Sie sich mit den Maintainern und der Community über diese Kanäle:

- Fehlerbericht oder Funktionsanfrage? Bitte [öffnen Sie ein Issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Sicherheitsprobleme? [security@puter.com](mailto:security@puter.com)
- E-Mail an die Maintainer: [hi@puter.com](mailto:hi@puter.com)

Wir helfen Ihnen gerne bei allen Fragen, die Sie haben könnten. Zögern Sie nicht zu fragen!

<br/>


## Lizenz

Dieses Repository, einschließlich aller Inhalte, Unterprojekte, Module und Komponenten, ist unter [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) lizenziert, sofern nicht ausdrücklich anders angegeben. In diesem Repository enthaltene Bibliotheken von Drittanbietern können ihren eigenen Lizenzen unterliegen.

<br/>
