<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">ఇంటర్నెట్ OS! ఉచితం, ఓపెన్-సోర్స్, మరియు స్వీయ-హోస్ట్ చేయగలిగేది.</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« LIVE DEMO »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://puter.com/app/app-center">App Store</a>
    ·
    <a href="https://developer.puter.com" target="_blank">Developers</a>
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

Puter ఒక అధునాతన, ఓపెన్-సోర్స్ ఇంటర్నెట్ ఆపరేటింగ్ సిస్టమ్ — వేగం, ఫీచర్లు మరియు విస్తరణ సామర్థ్యాల కోసం నిర్మించబడింది. Puter ఈ విధంగా ఉపయోగించవచ్చు:

- మీ ఫైళ్లు, అప్స్ మరియు గేమ్స్‌ను ఒకే చోట సురక్షితంగా అందుబాటులో ఉంచే ప్రైవసీ-ఫస్ట్ పర్సనల్ క్లౌడ్‌లా.
- వెబ్‌సైట్లు, వెబ్ అప్స్ మరియు గేమ్స్ నిర్మించి ప్రచురించడానికి ఒక ప్లాట్‌ఫారమ్‌గా.
- Dropbox, Google Drive, OneDrive లకు ప్రత్యామ్నాయంగా — కొత్త UI మరియు శక్తివంతమైన ఫీచర్లతో.
- సర్వర్లు మరియు వర్క్‌స్టేషన్లకు రిమోట్ డెస్క్‌టాప్ వాతావరణంగా.
- వెబ్ డెవలప్‌మెంట్, క్లౌడ్ కంప్యూటింగ్, డిస్ట్రిబ్యూటెడ్ సిస్టమ్స్ మరియు మరెన్నో నేర్చుకునేందుకు ఒక మంచి ఓపెన్-సోర్స్ ప్రాజెక్ట్ & కమ్యూనిటీగా!

<br/>

## Getting Started

### 💻 Local Development

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

**→** ఇది Puter ను ఈ అడ్రస్ వద్ద రన్ చేస్తుంది:  
<font color="red"> http://puter.localhost:4100 (లేదా తరువాతి అందుబాటులో ఉన్న పోర్ట్). </font>

ఇది పని చేయకపోతే, ట్రబుల్‌షూటింగ్ కోసం [First Run Issues](./doc/self-hosters/first-run-issues.md) చూడండి.

<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

**→** Puter అందుబాటులో ఉంటుంది:  
<font color="red"> http://puter.localhost:4100 (లేదా తరువాతి పోర్ట్). </font>

<br/>

### 🐙 Docker Compose

#### Linux/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

**→** Puter అందుబాటులో ఉంటుంది:  
<font color="red"> http://puter.localhost:4100 (లేదా తరువాతి పోర్ట్). </font>

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

**→** Puter అందుబాటులో ఉంటుంది:  
<font color="red"> http://puter.localhost:4100 (లేదా తరువాతి పోర్ట్). </font>

<br/>

### 🚀 Self-Hosting

వివరణాత్మక సెటప్ మరియు బెస్ట్ ప్రాక్టీసుల కోసం మా [Self-Hosting Documentation](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md) చూడండి.

<br/>

### ☁️ Puter.com

Puter హోస్టెడ్ సర్వీస్‌గా కూడా అందుబాటులో ఉంది — [**puter.com**](https://puter.com).

<br/>

## System Requirements

- **Operating Systems:** Linux, macOS, Windows
- **RAM:** కనీసం 2GB (సిఫార్సు 4GB)
- **Disk Space:** 1GB ఖాళీ స్థలం
- **Node.js:** Version 20.19.5+ (సిఫార్సు 23+)
- **npm:** తాజా స్థిరమైన వెర్షన్

<br/>

## Support

మెయింటైనర్లు మరియు కమ్యూనిటీతో సంప్రదించడానికి:

- Bug report లేదా feature request? [issue ఓపెన్ చేయండి](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- సెక్యూరిటీ ఇష్యూలు? [security@puter.com](mailto:security@puter.com)
- మెయింటెయినర్స్‌కి ఇమెయిల్: [hi@puter.com](mailto:hi@puter.com)

మీకు ఏ ప్రశ్నలున్నా మేము సంతోషంగా సహాయం చేస్తాం!

<br/>

## License

ఈ రిపోజిటరీ, అందులోని అన్ని మాడ్యూల్స్, కాంపోనెంట్స్, సబ్-ప్రాజెక్ట్స్ సహా అన్నీ [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) లైసెన్స్‌లో లైసెన్స్ చేయబడ్డాయి. థర్డ్-పార్టీ లైబ్రరీలకు వారి స్వంత లైసెన్సులు ఉండవచ్చు.

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
- [German /  Deutsch](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.de.md)
- [Hebrew/ עברית](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.he.md)
- [Hindi / हिंदी](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md)
- [Hungarian / Magyar](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hu.md)
- [Indonesian / Bahasa Indonesia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.id.md)
- [Italian / Italiano](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.it.md)
- [Japanese / 日本語](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md)
- [Korean / 한국어](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ko.md)
- [Malay / Bahasa Malaysia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.my.md)
- [Malayalam / മലയാളം](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ml.md)
- [Polish / Polski](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pl.md)
- [Portuguese / Português](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md)
- [Punjabi / ਪੰਜਾਬੀ](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pa.md)
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

## Links to Other READMEs
### Backend
- [PuterAI Module](./src/backend/doc/modules/puterai/README.md)
- [Metering Service](./src/backend/src/services/MeteringService/README.md)
- [Extensions Development Guide](./extensions/README.md)

