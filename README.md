<h3 align="center"><img width="80" alt="Puter.com, L’ordinateur personnel dans le cloud : Tous vos fichiers, applications et jeux dans un seul endroit, accessibles de n’importe où et à tout moment." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Le système d'exploitation d'Internet ! Gratuit, Open-Source et auto-hébergeable.</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« DÉMO EN DIRECT »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://puter.com/app/app-center">App Store</a>
    ·
    <a href="https://developer.puter.com" target="_blank">Développeurs</a>
    ·
    <a href="https://github.com/heyputer/puter-cli" target="_blank">CLI</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="capture d’écran" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter est un système d'exploitation Internet avancé, open-source, conçu pour être riche en fonctionnalités, extrêmement rapide et hautement extensible. Puter peut être utilisé comme :

- Un cloud personnel axé sur la confidentialité pour conserver tous vos fichiers, applications et jeux dans un endroit sécurisé, accessible de partout et à tout moment.
- Une plateforme pour créer et publier des sites web, applications web et jeux.
- Une alternative à Dropbox, Google Drive, OneDrive, etc., avec une interface moderne et de puissantes fonctionnalités.
- Un environnement de bureau à distance pour serveurs et stations de travail.
- Un projet et une communauté open-source accueillants pour apprendre le développement web, le cloud computing, les systèmes distribués, et bien plus encore !

<br/>

## Bien démarrer

### 💻 Développement local

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** Cela devrait lancer Puter sur  
<font color="red"> http://puter.localhost:4100 (ou le prochain port disponible). </font>

Si cela ne fonctionne pas, consultez [First Run Issues](./doc/self-hosters/first-run-issues.md) pour les étapes de dépannage.

<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```
**→** Cela devrait lancer Puter sur  
<font color="red"> http://puter.localhost:4100 (ou le prochain port disponible). </font>

<br/>

### 🐙 Docker Compose

#### Linux/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```
**→** Cela devrait être disponible sur  
<font color="red"> http://puter.localhost:4100 (ou le prochain port disponible). </font>

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
**→** Cela devrait lancer Puter sur  
<font color="red"> http://puter.localhost:4100 (ou le prochain port disponible). </font>

<br/>

### 🚀 Auto-hébergement

Pour des guides détaillés sur l’auto-hébergement de Puter, incluant les options de configuration et bonnes pratiques, consultez notre [documentation d’auto-hébergement](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md).

<br/>

### ☁️ Puter.com

Puter est également disponible en service hébergé sur [**puter.com**](https://puter.com).

<br/>

## Configuration requise

- **Systèmes d’exploitation :** Linux, macOS, Windows  
- **RAM :** minimum 2GB (4GB recommandé)  
- **Espace disque :** 1GB libre  
- **Node.js :** Version 20.19.5+ (23+ recommandé)  
- **npm :** Dernière version stable  

<br/>

## Support

Contactez les mainteneurs et la communauté via les canaux suivants :

- Rapport de bug ou demande de fonctionnalité ? Veuillez [ouvrir une issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord : [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter) : [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit : [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon : [mastodon.social/@puter](https://mastodon.social/@puter)
- Problèmes de sécurité ? [security@puter.com](mailto:security@puter.com)
- Contact par email : [hi@puter.com](mailto:hi@puter.com)

Nous serons toujours ravis de vous aider. N’hésitez pas à poser vos questions !

<br/>

## Licence

Ce dépôt, incluant tout son contenu, sous-projets, modules et composants, est sous licence [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) sauf indication contraire explicite.  
Les bibliothèques tierces incluses dans ce dépôt peuvent être soumises à leurs propres licences.

<br/>

## Traductions

- [Arabe / العربية](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ar.md)
- [Arménien / Հայերեն](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hy.md)
- [Bengali / বাংলা](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.bn.md)
- [Chinois / 中文](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.zh.md)
- [Danois / Dansk](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.da.md)
- [Anglais](https://github.com/HeyPuter/puter/blob/main/README.md)
- [Farsi / فارسی](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fa.md)
- [Finnois / Suomi](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fi.md)
- [Français](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fr.md)
- [Allemand / Deutsch](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.de.md)
- [Hébreu / עברית](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.he.md)
- [Hindi / हिंदी](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md)
- [Hongrois / Magyar](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hu.md)
- [Indonésien / Bahasa Indonesia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.id.md)
- [Italien / Italiano](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.it.md)
- [Japonais / 日本語](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md)
- [Coréen / 한국어](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ko.md)
- [Malais / Bahasa Malaysia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.my.md)
- [Malayalam / മലയാളം](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ml.md)
- [Polonais / Polski](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pl.md)
- [Portugais / Português](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md)
- [Roumain / Română](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ro.md)
- [Russe / Русский](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ru.md)
- [Espagnol / Español](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.es.md)
- [Suédois / Svenska](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.sv.md)
- [Tamoul / தமிழ்](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ta.md)
- [Telugu / తెలుగు](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.te.md)
- [Thaï / ไทย](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.th.md)
- [Turc / Türkçe](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.tr.md)
- [Ukrainien / Українська](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ua.md)
- [Urdu / اردو](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ur.md)
- [Vietnamien / Tiếng Việt](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.vi.md)

## Liens vers d’autres README
### Backend
- [Module PuterAI](./src/backend/doc/modules/puterai/README.md)
- [Service de Mesure](./src/backend/src/services/MeteringService/README.md)
- [Guide de développement des extensions](./extensions/README.md)
