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

<h3 align="center"><img width="700" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

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

This will launch Puter at http://localhost:4000 (or the next available port).

<br/>

### 🐳 Docker


```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>


### 🐙 Docker Compose


```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```
<br/>

### ☁️ Puter.com

Puter is available as a hosted service at [**puter.com**](https://puter.com).

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
- [Ladybird Browser](https://x.com/HeyPuter/status/1810783504503800035)

<br/>

##  License

This repository, including all its contents, sub-projects, modules, and components, is licensed under [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) unless explicitly stated otherwise. Third-party libraries included in this repository may be subject to their own licenses.

<br/>
