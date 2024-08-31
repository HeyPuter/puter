<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>
<h3 align="center">Internetin käyttöjärjestelmä! Ilmainen, avoimen lähdekoodin ja itse isännöitävä.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=viimeisin%20versio"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
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
    <a href="https://www.youtube.com/@EricsPuterVideos">YouTube</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (Twitter)</a>
    ·
    <a href="https://hackerone.com/puter_h1b">Bug Bounty</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="näyttökuva" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter on kehittynyt, avoimen lähdekoodin internetin käyttöjärjestelmä, joka on suunniteltu olemaan ominaisuuksiltaan rikas, poikkeuksellisen nopea ja erittäin laajennettava. Puteria voidaan käyttää:

- Yksityisyyttä kunnioittavana henkilökohtaisena pilvenä, johon voit tallentaa kaikki tiedostosi, sovelluksesi ja pelisi turvallisesti yhdessä paikassa, josta ne ovat saatavilla missä tahansa ja milloin tahansa.
- Alustana verkkosivustojen, web-sovellusten ja pelien rakentamiseen ja julkaisemiseen.
- Vaihtoehtona Dropboxille, Google Drivelle, OneDrivelle jne. tuoreella käyttöliittymällä ja tehokkailla ominaisuuksilla.
- Etätyöpöytäympäristönä palvelimille ja työasemille.
- Ystävällisenä, avoimen lähdekoodin projektina ja yhteisönä, jossa voit oppia verkkokehityksestä, pilvipalveluista, hajautetuista järjestelmistä ja paljon muusta!

<br/>

## Aloittaminen


### 💻 Paikallinen kehitys

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Tämä käynnistää Puterin osoitteessa http://puter.localhost:4100 (tai seuraavassa vapaassa portissa).

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

Puter on saatavilla isännöitynä palveluna osoitteessa [**puter.com**](https://puter.com).

<br/>

## Järjestelmävaatimukset

- **Käyttöjärjestelmät:** Linux, macOS, Windows
- **RAM:** Vähintään 2GB (Suositeltu 4GB)
- **Levytila:** 1GB vapaata tilaa
- **Node.js:** Versio 16+ (Suositeltu versio 22+)
- **npm:** Uusin vakaa versio

<br/>

## Tuki

Ota yhteyttä ylläpitäjiin ja yhteisöön näiden kanavien kautta:

- Onko sinulla virheraportti tai ominaisuuspyyntö? Ole hyvä ja [avaa uusi issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Turvallisuusongelmat? [security@puter.com](mailto:security@puter.com)
- Ota yhteyttä ylläpitäjiin sähköpostitse osoitteessa [hi@puter.com](mailto:hi@puter.com)

Olemme aina valmiita auttamaan sinua kaikissa kysymyksissäsi. Älä epäröi kysyä!

<br/>


##  Lisenssi

Tämä repository, mukaan lukien kaikki sen sisältö, aliprojektit, moduulit ja komponentit, on lisensoitu [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt)-lisenssillä, ellei toisin mainita. Tämän repositoryn mukana tulevat kolmannen osapuolen kirjastot voivat olla omien lisenssiensä alaisia.

<br/>
