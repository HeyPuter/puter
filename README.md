<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">The Internet OS! Free, Open-Source, and Self-Hostable.</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« LIVE DEMO »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://puter.com/app/app-center">App Store</a>
    ·
    <a href="https://docs.puter.com" target="_blank">SDK</a>
    ·
    <a href="https://github.com/heyputer/puter-cli" target="_blank">CLI</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter is an advanced, open-source internet operating system designed to be feature-rich, exceptionally fast, and highly extensible. Puter can be used as:

- A privacy-first personal cloud to keep all your files, apps, and games in one secure place, accessible from anywhere at any time.
- A platform for building and publishing websites, web apps, and games.
- An alternative to Dropbox, Google Drive, OneDrive, etc. with a fresh interface and powerful features.
- A remote desktop environment for servers and workstations.
- A friendly, open-source project and community to learn about web development, cloud computing, distributed systems, and much more!

<br/>

## Getting Started

### 💻 Local Development

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

This will launch Puter at http://puter.localhost:4100 (or the next available port).

If this does not work, see [First Run Issues](./doc/self-hosters/first-run-issues.md) for
troubleshooting steps.

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

### 🚀 Self-Hosting

For detailed guides on self-hosting Puter, including configuration options and best practices, see our [Self-Hosting Documentation](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md).

<br/>

### ☁️ Puter.com

Puter is available as a hosted service at [**puter.com**](https://puter.com).

<br/>

## Setup Wizard

When you first start Puter, you'll be automatically redirected to the Setup Wizard. This wizard helps you configure your Puter instance with the following settings:

### Subdomain Configuration

- **Enabled (Recommended)**: Enables the use of subdomains for enhanced security and functionality. This is the recommended setting for most deployments.
- **Disabled**: Turns off subdomain functionality. Only use this if your hosting environment doesn't support subdomains. Note that disabling subdomains reduces security isolation between applications.

### Domain Configuration

- **Custom Domain**: Configure Puter to use your own domain name (e.g., yourdomain.com).
- **Use nip.io (IP-based)**: Automatically creates a domain based on your server's IP address using the nip.io service. This is useful for testing or when you don't have a custom domain.

### Admin User Password

- Set a secure password for the admin user account. This account has full administrative privileges over your Puter instance.

### How to Reset the Setup Wizard

If you need to redo the setup wizard after initial configuration:

1. Delete the setup-completed marker file:

   ```bash
   rm ./volatile/runtime/config/setup-completed
   ```

2. Optionally, delete the configuration file for a clean start:

   ```bash
   rm ./volatile/runtime/config/wizard-config.json
   ```

3. Restart Puter, and the setup wizard will appear again.

### Configuration Reset

If you need to reset various aspects of your Puter configuration, here are the files to delete based on what you want to reset:

#### Basic Setup Wizard Reset

```bash
# Redo the setup wizard only
rm ./volatile/runtime/config/setup-completed
```

#### Complete Configuration Reset

```bash
# Reset all configuration files
rm -rf ./volatile/runtime/config/*
rm -rf ./volatile/config/*
rm -rf ./config/*  # If exists
```

#### User Data Reset

```bash
# Reset user data (this will delete all user files and accounts)
rm -rf ./volatile/runtime/data/*
```

#### Full Reset

```bash
# Complete reset of all configuration and data
rm -rf ./volatile/runtime/config/*
rm -rf ./volatile/runtime/data/*
rm -rf ./volatile/config/*
```

> ⚠️ **Warning**: Deleting configuration and data files will permanently remove user accounts, uploaded files, and all settings. Make sure to backup any important data before proceeding.

### Port Conflict Resolution

If you experience redirection loops between ports (e.g., between port 4100 and /\_\_setup) after completing the setup wizard, you may be encountering a port conflict issue. This happens when the setup wizard and main app try to use the same port.

To resolve this:

1. Stop any running Puter processes
2. Use our port conflict resolution tool:

   ```bash
   node tools/fix-port-conflict.js
   ```

   This script will:

   - Remove the setup completion marker
   - Allow you to select a specific port or use automatic port selection
   - Provide instructions for restarting Puter cleanly

3. Alternatively, use a manual approach:

   ```bash
   # Remove the setup completed marker
   rm ./volatile/runtime/config/setup-completed

   # Start with a different port
   PORT=4200 npm start
   ```

4. After completing the setup wizard again, you may need to:
   - Restart your browser or use an incognito window
   - Clear browser cookies for the Puter domain
   - Access Puter using the correct port shown in the console

<br/>

## System Requirements

- **Operating Systems:** Linux, macOS, Windows
- **RAM:** 2GB minimum (4GB recommended)
- **Disk Space:** 1GB free space
- **Node.js:** Version 16+ (Version 22+ recommended)
- **npm:** Latest stable version

<br/>

## Support

Connect with the maintainers and community through these channels:

- Bug report or feature request? Please [open an issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Security issues? [security@puter.com](mailto:security@puter.com)
- Email maintainers at [hi@puter.com](mailto:hi@puter.com)

We are always happy to help you with any questions you may have. Don't hesitate to ask!

<br/>

## License

This repository, including all its contents, sub-projects, modules, and components, is licensed under [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) unless explicitly stated otherwise. Third-party libraries included in this repository may be subject to their own licenses.

<br/>

## Translations

- [Arabic / العربية](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ar.md)
- [Armenian / Հայերեն](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hy.md)
- [Bengali / বাংলা](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.bn.md)
- [Chinese / 中文](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.zh.md)
- [Danish / Dansk](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.da.md)
- [English](https://github.com/HeyPuter/puter/blob/main/README.md)
- [Farsi / فارسی](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fa.md)
- [Finnish / Suomi](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fi.md)
- [French / Français](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fr.md)
- [German/ Deutsch](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.de.md)
- [Hebrew/ עברית](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.he.md)
- [Hindi / हिंदी](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md)
- [Hungarian / Magyar](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hu.md)
- [Indonesian / Bahasa Indonesia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.id.md)
- [Italian / Italiano](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.it.md)
- [Japanese / 日本語](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md)
- [Korean / 한국어](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ko.md)
- [Malayalam / മലയാളം](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ml.md)
- [Polish / Polski](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pl.md)
- [Portuguese / Português](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md)
- [Romanian / Română](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ro.md)
- [Russian / Русский](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ru.md)
- [Spanish / Español](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.es.md)
- [Swedish / Svenska](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.sv.md)
- [Tamil / தமிழ்](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ta.md)
- [Telugu / తెలుగు](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.te.md)
- [Thai / ไทย](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.th.md)
- [Turkish / Türkçe](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.tr.md)
- [Ukrainian / Українська](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ua.md)
- [Urdu / اردو](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ur.md)
- [Vietnamese / Tiếng Việt](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.vi.md)
