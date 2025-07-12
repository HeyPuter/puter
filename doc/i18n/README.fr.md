<h3 align="center"><img width="80" alt="Puter.com, L'ordinateur cloud personnel : Tous vos fichiers, applications et jeux en un seul endroit accessible de partout à tout moment." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">L'OS Internet ! Gratuit, open-source et auto-hébergeable.</h3>

<p align="center">
    <img alt="Taille du dépôt GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="Version GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=derni%C3%A8re%20version"> <img alt="Licence GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« DÉMO EN DIRECT »</strong></a>
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="capture d'écran" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter est un système d'exploitation internet avancé, open-source, conçu pour être riche en fonctionnalités, extrêmement rapide et hautement extensible. Puter peut être utilisé comme :

- Un cloud personnel axé sur la confidentialité pour garder tous vos fichiers, applications et jeux en un seul endroit sécurisé, accessible de partout à tout moment.
- Une plateforme pour créer et publier des sites web, des applications web et des jeux.
- Une alternative à Dropbox, Google Drive, OneDrive, etc. avec une interface renouvelée et des fonctionnalités puissantes.
- Un environnement de bureau à distance pour serveurs et stations de travail.
- Un projet et une communauté open-source accueillants pour apprendre le développement web, l'informatique en nuage, les systèmes distribués, et bien plus encore !

<br/>

## Démarrage

### 💻 Développement Local

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Cela lancera Puter à http://puter.localhost:4100 (ou au port disponible suivant).

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

Puter est disponible en tant que service hébergé sur [**puter.com**](https://puter.com).

<br/>

## Configuration système requise

- **Systèmes d'exploitation:** Linux, macOS, Windows
- **RAM:** Minimum 2 Go (4 Go recommandés)
- **Espace disque:** 1 Go d'espace libre
- **Node.js:** Version 16+ (Version 22+ recommandée)
- **npm:** Dernière version stable

<br/>

## Support

Connectez-vous avec les mainteneurs et la communauté via ces canaux :

- Un bug ou une demande de fonctionnalité ? Veuillez [ouvrir une issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Problèmes de sécurité ? [security@puter.com](mailto:security@puter.com)
- Email des mainteneurs à [hi@puter.com](mailto:hi@puter.com)

Nous sommes toujours heureux de vous aider avec toutes les questions que vous pourriez avoir. N'hésitez pas à nous demander !

<br/>

## License

Ce dépôt, y compris tout son contenu, sous-projets, modules et composants, est licencié sous [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) sauf indication contraire explicite. Les bibliothèques tierces incluses dans ce dépôt peuvent être soumises à leurs propres licences.

<br/>
