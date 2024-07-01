<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">The Internet OS! Free, Open-Source, and Self-Hostable.</h3>

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
    ·
    <a href="https://hackerone.com/puter_h1b">Bug Bounty</a>
</p>

<h3 align="center"><img width="700" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-2.webp"></h3>

<br/>

## Puter

Puter is an advanced, open-source internet operating system designed to be feature-rich, exceptionally fast, and highly extensible. It can be used to build remote desktop environments or serve as an interface for cloud storage services, remote servers, web hosting platforms, and more.

<br/>

## Getting Started

After reading this section, please proceed to [**Self-Hosting**](#%EF%B8%8F-self-hosting-%EF%B8%8F) and [**Configuration**](#configuration) below.
Read these instructions carefully or you may see errors due to
an invalid setup.

### Local Development

```bash
git clone https://github.com/HeyPuter/puter
cd puter
cp .env.example .env
npm install
npm start
```

This will launch Puter at http://localhost:4000 (or the next available port).

<br/>

### Using Docker

**note:** it is **not** necessary to run this within a clone of this repository. For contributors, it is recommended to use the [Local Development](#local-development) instructions.

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

### Using Docker Compose

**note:** it is **not** necessary to run this within a clone of this repository. For contributors, it is recommended to use the [Local Development](#local-development) instructions.

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker-compose up -d
```

<br/>

See [Configuration](#configuration) for next steps.

<br/>

> [!WARNING]
> The self-hosted version of Puter is currently in alpha stage and should not be used in production yet. It is under active development and may contain bugs, other issues. Please exercise caution and use it for testing and evaluation purposes only.

### Self-Hosting Differences
Currently, the self-hosted version of Puter is different in a few ways from [Puter.com](https://puter.com):
- There is no built-in way to install or create other apps (see below)
- Several "core" apps are missing, such as **Code** or **Draw**, because we can't include them in this repository
- Some icons are different

Work is ongoing to improve the **App Center** and make it available on self-hosted.
Until then, it's possible to add other apps by manually editing the database file.
This process is not recommended unless you know what you are doing.
The file will appear after you first launch Puter, and should be found in `puter/data/puter-database.sqlite` for Docker,
or `volatile/runtime/puter-database.sqlite` otherwise.
You will need a database tool that can understand SQLite databases.

<br/>

## Configuration

Running the server will generate a configuration file in one of these locations:
- `config/config.json` when [Using Docker](#using-docker)
- `volatile/config/config.json` in [Local Development](#local-development)
- `/etc/puter/config.json` on a server (or within a Docker container)

### Domain Name

To access Puter on your device, you can simply go to the address printed in
the server console (usually `puter.localhost:4100`).

To access Puter from another device, a domain name must be configured, as well as
an `api` subdomain. For example, `example.local` might be the domain name pointing
to the IP address of the server running puter, and `api.example.com` must point to
this address as well. This domain must be specified in the configuration file
(usually `volatile/config/config.json`) as well.

See [domain configuration](./doc/self-hosters/domains.md) for more information.

### Configure the Port

- You can specify a custom port by setting `http_port` to a desired value
- If you're using a reverse-proxy such as nginx or cloudflare, you should
  also set `pub_port` to the public (external) port (usually `443`)
- If you have HTTPS enabled on your reverse-proxy, ensure that
  `protocol` in config.json is set accordingly

### Default User

By default, Puter will create a user called `default_user`.
This user will have a randomly generated password, which will be printed
in the development console.
A warning will persist in the dev console until this user's
password is changed. Please login to this user and change the password as
your first step.

<br/>

##  License

This repository is licensed under AGPL-3.0; However, our SDK (puter.js) is also available under Apache 2.0, as indicated by the license file in that section (packages/puter-js) of this repository.

<br/>

## FAQ

### ❓ What's the use case for Puter?

Puter can be used as:

- An alternative to Dropbox, Google Drive, OneDrive, etc. with a fresh interface and powerful features.
- Remote desktop environment for servers and workstations.
- A platform for building and hosting websites, web apps, and games.
- A friendly, open-source project and community to learn about web development, cloud computing, distributed systems, and much more!

<br/>


### ❓ Why isn't Puter built with React, Angular, Vue, etc.?

For performance reasons, Puter is built with vanilla JavaScript and jQuery. Additionally, we'd like to avoid complex abstractions and to remain in control of the entire stack, as much as possible.

Also partly inspired by some of our favorite projects that are not built with frameworks: [VSCode](https://github.com/microsoft/vscode), [Photopea](https://www.photopea.com/), and [OnlyOffice](https://www.onlyoffice.com/).

<br/>

### ❓ Why jQuery?

Puter interacts directly with the DOM and jQuery provides an elegant yet powerful API to manipulate the DOM, handle events, and much more. It's also fast, mature, and battle-tested. 

<br/>

## #DoesItRunPuter

- [Minecraft](https://twitter.com/HeyPuter/status/1771957571496092036) | [video](https://www.youtube.com/watch?v=GIowZUXkg5g)
- [Samsung Watch](https://twitter.com/CharmunkDev/status/1781501714543030554)
- [PlayStation 4](https://twitter.com/HeyPuter/status/1767978053014270059)
- [Skyworth TV](https://twitter.com/ericalexdube/status/1767983049277411564)
- [A Fridge!](https://twitter.com/HeyPuter/status/1778890003797745842)
- [Oculus Quest 2](https://twitter.com/HeyPuter/status/1768664081756754012)
- [Tesla Model 3](https://twitter.com/EricLighthall/status/1781479732997214501)
- [Tesla Model S](https://twitter.com/HeyPuter/status/1767971178864587057)
- [Tesla Model Y](https://twitter.com/HeyPuter/status/1772858333751636310)
- [Nintendo Switch](https://twitter.com/HeyPuter/status/1780645795240538518)
- [Steam Deck](https://twitter.com/everythingSung/status/1782162352403828793)

<br/>

## Credits

The default wallpaper is created by [Milad Fakurian](https://unsplash.com/photos/blue-orange-and-yellow-wallpaper-E8Ufcyxz514) and published on [Unsplash](https://unsplash.com/).

Icons by [Papirus](https://github.com/PapirusDevelopmentTeam/papirus-icon-theme) under GPL-3.0 license.

Icons by [Iconoir](https://iconoir.com/) under MIT license.

Icons by [Elementary Icons](https://github.com/elementary/icons) under GPL-3.0 license.

Icons by [Tabler Icons](https://tabler.io/) under MIT license.

Icons by [bootstrap-icons](https://icons.getbootstrap.com/) under MIT license.
