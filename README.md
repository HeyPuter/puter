# Puter — The Internet OS
[![Website](https://img.shields.io/badge/puter.com-live-brightgreen)](https://puter.com/?ref=github.com)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt)
[![Discord](https://img.shields.io/badge/discord-join-7289DA)](https://discord.com/invite/PQcx7Teh8u)
[![Docs](https://img.shields.io/badge/docs-self--hosters-orange)](https://github.com/HeyPuter/puter/tree/main/doc/self-hosters)

Puter is an open-source "Internet Operating System": a modern, self-hostable cloud desktop that lets you run your files, apps, and games from anywhere. It can be used as a personal cloud, a platform to deploy web apps, a remote desktop environment, or simply as an alternative to consumer cloud drives — with strong privacy and extensibility in mind.

Live demo: https://puter.com/?ref=github.com

Why Puter?
- Personal cloud designed to keep you in control of your data.
- Extensible platform for apps, websites and games.
- Fast, polished UI and developer-friendly architecture.
- Self-hostable or available as a hosted service at puter.com.

Screenshot
![Puter screenshot](https://assets.puter.site/puter.com-screenshot-3.webp)

Table of contents
- Overview
- Features
- Quickstart — Local Development
- Docker & Docker Compose
- Production / Self-hosting (recommended)
- Architecture & Components
- System Requirements
- Configuration & Common Options
- Troubleshooting & First Run Issues
- Security & Responsible Disclosure
- Contributing
- Translations
- Links to other READMEs
- License
- Acknowledgements & Credits
- FAQ
- Roadmap

Overview
--------
Puter is a modular web-native desktop environment with:
- File storage and sync
- App center for web apps and games
- Remote desktop capabilities
- Developer tools and extensibility model
- Integrations for storage, authentication, and services

Features
--------
- Multi-user personal cloud with permissions
- App Center (install/uninstall web apps)
- Fast, modern React/TypeScript frontend (progressive)
- Backend services for storage, metering, and extensions
- Self-hostable via Docker or source
- Rich developer documentation and extension examples

Quickstart — Local Development
------------------------------
These steps will get a development instance running on your machine.

Prerequisites
- Node.js 20.x or newer (Node 23+ recommended)
- npm (or pnpm/yarn if you prefer)
- Git

Clone, install, run:
```bash
git clone https://github.com/HeyPuter/puter.git
cd puter
npm install
npm start
```

After start: open http://puter.localhost:4100 (or the next available port) in your browser.

Notes:
- If the UI doesn't come up, check the console/logs and see doc/self-hosters/first-run-issues.md for common problems.
- For development you may want to run backend and frontend separately if the monorepo provides dev scripts.

Docker
------
Run with a single container for evaluation or small self-hosting:

```bash
mkdir puter && cd puter
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
docker run --rm -p 4100:4100 \
  -v "$(pwd)/puter/config:/etc/puter" \
  -v "$(pwd)/puter/data:/var/puter" \
  ghcr.io/heyputer/puter:latest
```

This exposes the UI at http://puter.localhost:4100 (or the next available port).

Docker Compose
--------------
Linux / macOS:
```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
curl -fsSL https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml -o docker-compose.yml
docker compose up
```

Windows (PowerShell):
```powershell
mkdir puter
cd puter
New-Item -Path "puter\config" -ItemType Directory -Force
New-Item -Path "puter\data" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml" -OutFile "docker-compose.yml"
docker compose up
```

Production / Self-hosting
-------------------------
For production-grade self-hosting:
- Run behind a reverse proxy (NGINX, Traefik) with TLS (Let's Encrypt or other CA).
- Mount persistent directories for config and data.
- Use a process supervisor or container orchestration (systemd, Docker Compose, Kubernetes).
- Configure user auth, backups, and recommended production flags found in doc/self-hosters.
See the Self-Hosting Documentation:
https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md

Recommended reverse proxy snippet (NGINX example)
```nginx
server {
    listen 80;
    server_name puter.example.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name puter.example.com;
    ssl_certificate /etc/letsencrypt/live/puter.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/puter.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Architecture & Components
-------------------------
- Frontend: Modern single-page app (React/TypeScript) — desktop UI, app store.
- Backend services: Storage, metering, app hosting and APIs.
- Extensions: Optional modules that extend platform functionality.
- Data: Files and metadata stored on disk or pluggable storage backends.

See src/backend and extensions/ READMEs for detailed module-level docs.

System Requirements
-------------------
Minimum (light usage)
- 2 GB RAM (4 GB recommended)
- 1 GB disk free (plus space for user files)
- Linux/macOS/Windows
- Node.js 20.19.5+ (23+ recommended for production)
- npm: latest stable

Configuration & Common Options
------------------------------
- Default ports: 4100 (UI / API)
- Config files: /etc/puter (in container mount)
- Data folder: /var/puter (persist mounts)
- UID/GID: containers expect files owned by UID 1000 by default — adjust chown as needed

Troubleshooting & First Run Issues
----------------------------------
If something fails on first run:
- Check the container logs: docker logs <container>
- Verify mounts and permissions (UID 1000 recommended)
- Confirm port conflicts (4100)
- See doc/self-hosters/first-run-issues.md for detailed debugging steps
- Reach out on Discord for community help

Security & Responsible Disclosure
---------------------------------
Security issues should be reported to security@puter.com. Do not disclose vulnerabilities publicly until they have been responsibly addressed.

Contributing
------------
We welcome contributions of all sizes.

Start by reading:
- CONTRIBUTING.md (if present)
- Code of Conduct (usually in CODE_OF_CONDUCT.md)

Typical workflow:
1. Fork the repo
2. Create a branch: git checkout -b feat/your-feature
3. Implement, test, and add docs
4. Open a Pull Request against main

Useful dev commands:
```bash
# Install dependencies
npm install

# Run tests (if available)
npm test

# Lint
npm run lint

# Build
npm run build
```

Translations
------------
Contributions for translations are welcome. Existing translations:
- Arabic / العربية — doc/i18n/README.ar.md
- Armenian / Հայերեն — doc/i18n/README.hy.md
- Bengali / বাংলা — doc/i18n/README.bn.md
- Chinese / 中文 — doc/i18n/README.zh.md
- Danish / Dansk — doc/i18n/README.da.md
- English — README.md
- Farsi / فارسی — doc/i18n/README.fa.md
- Finnish / Suomi — doc/i18n/README.fi.md
- French / Français — doc/i18n/README.fr.md
- German / Deutsch — doc/i18n/README.de.md
- Hebrew / עברית — doc/i18n/README.he.md
- Hindi / हिंदी — doc/i18n/README.hi.md
- Hungarian / Magyar — doc/i18n/README.hu.md
- Indonesian — doc/i18n/README.id.md
- Italian / Italiano — doc/i18n/README.it.md
- Japanese / 日本語 — doc/i18n/README.jp.md
- Korean / 한국어 — doc/i18n/README.ko.md
- Malay / Bahasa Malaysia — doc/i18n/README.my.md
- Malayalam — doc/i18n/README.ml.md
- Polish / Polski — doc/i18n/README.pl.md
- Portuguese / Português — doc/i18n/README.pt.md
- Romanian / Română — doc/i18n/README.ro.md
- Russian / Русский — doc/i18n/README.ru.md
- Spanish / Español — doc/i18n/README.es.md
- Swedish / Svenska — doc/i18n/README.sv.md
- Tamil / தமிழ் — doc/i18n/README.ta.md
- Telugu / తెలుగు — doc/i18n/README.te.md
- Thai / ไทย — doc/i18n/README.th.md
- Turkish / Türkçe — doc/i18n/README.tr.md
- Ukrainian / Українська — doc/i18n/README.ua.md
- Urdu / اردو — doc/i18n/README.ur.md
- Vietnamese / Tiếng Việt — doc/i18n/README.vi.md

Links to Other READMEs
----------------------
### Backend
- PuterAI Module: ./src/backend/doc/modules/puterai/README.md
- Metering Service: ./src/backend/src/services/MeteringService/README.md
- Extensions Development Guide: ./extensions/README.md

License
-------
This repository and most of its contents are licensed under AGPL-3.0 unless otherwise stated. See LICENSE.txt in the upstream repo for details:
https://github.com/HeyPuter/puter/blob/main/LICENSE.txt

Acknowledgements & Credits
--------------------------
Puter is developed and maintained by the HeyPuter community and contributors. Special thanks to all extension authors, translators, and community members.

FAQ (short)
-----------
Q: Where do I report bugs or feature requests?
A: Open an issue in the upstream issue tracker: https://github.com/HeyPuter/puter/issues/new/choose

Q: Can I run Puter for multiple users?
A: Yes — Puter supports multi-user setups. See the self-hosting docs for config and scaling guidance.

Roadmap (high level)
--------------------
- Harden deployment / production cookbook
- More official cloud storage backends (S3, GCS)
- Better multi-node scaling / clustering
- Additional official translations and help docs

Need help?
----------
- Join the community on Discord: https://discord.com/invite/PQcx7Teh8u
- Reddit: https://reddit.com/r/puter
- Twitter/X: https://x.com/HeyPuter
- Email: hi@puter.com
- Security: security@puter.com

Thank you for trying Puter — we hope it helps you take back control of your online workspace.
