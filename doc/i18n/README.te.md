<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: మీ అన్ని ఫైల్‌లు, యాప్‌లు మరియు గేమ్‌లను ఒకే స్థలంలో ఎక్కడి నుండైనా ఎప్పుడైనా యాక్సెస్ చేయవచ్చు." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center"> ఇంటర్నెట్ OS! ఉచిత, ఓపెన్ సోర్స్, and Self-Hostable.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« ప్రత్యక్ష ప్రదర్శన »</strong></a>
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## పుటర్ (Puter)

పుటర్ అనేది అధునాతన, ఓపెన్ సోర్స్ ఇంటర్నెట్ ఆపరేటింగ్ సిస్టమ్, ఇది ఫీచర్-రిచ్, అనూహ్యంగా వేగవంతమైన మరియు అత్యంత విస్తరించదగినదిగా రూపొందించబడింది. పుటర్‌ను ఇలా ఉపయోగించవచ్చు:

- మీ అన్ని ఫైల్‌లు, యాప్‌లు మరియు గేమ్‌లను ఒకే సురక్షిత స్థలంలో ఉంచడానికి గోప్యత-మొదటి వ్యక్తిగత క్లౌడ్, ఎప్పుడైనా ఎక్కడి నుండైనా యాక్సెస్ చేయవచ్చు.
- వెబ్‌సైట్‌లు, వెబ్ యాప్‌లు మరియు గేమ్‌లను రూపొందించడానికి మరియు ప్రచురించడానికి ఒక వేదిక.
- తాజా ఇంటర్‌ఫేస్ మరియు శక్తివంతమైన ఫీచర్‌లతో Dropbox, Google Drive, OneDrive మొదలైన వాటికి ప్రత్యామ్నాయం.
- సర్వర్లు మరియు వర్క్‌స్టేషన్‌ల కోసం రిమోట్ డెస్క్‌టాప్ వాతావరణం.
- వెబ్ డెవలప్‌మెంట్, క్లౌడ్ కంప్యూటింగ్, డిస్ట్రిబ్యూట్ సిస్టమ్‌లు మరియు మరిన్నింటి గురించి తెలుసుకోవడానికి స్నేహపూర్వక, ఓపెన్ సోర్స్ ప్రాజెక్ట్ మరియు కమ్యూనిటీ!

<br/>

## ప్రారంభించడం

### లోకల్ డెవలప్మెంట్

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

ఇది http://puter.localhost:4100 (లేదా తదుపరి అందుబాటులో ఉన్న పోర్ట్) వద్ద పుటర్‌ని ప్రారంభిస్తుంది.

ఇది పని చేయకపోతే, దీని కోసం [మొదటి రన్ సమస్యలు](./doc/first-run-issues.md) చూడండి
ట్రబుల్షూటింగ్ దశలు.

<br/>

### 🐳 డోకర్

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

### 🐙 డోకర్ Compose

#### లినక్స్/ macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>

#### విండోస్

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

పుటర్ [**puter.com**](https://puter.com)లో హోస్ట్ చేయబడి ఉంది.

<br/>

## System Requirements

- **ఆపరేటింగ్ సిస్టమ్స్:** లినక్స్, macOS, విండోస్
- **RAM:** 2GB కనీసం(4GB recommended)
- **Disk Space:** 1GB ఖాళీ
- **Node.js:** Version 16+ (Version 22+ recommended)
- **npm:** Latest stable version

<br/>

## Support

ఈ ఛానెల్‌ల ద్వారా నిర్వాహకులు మరియు సంఘంతో కనెక్ట్ అవ్వండి:

- బగ్ నివేదిక లేదా ఫీచర్ అభ్యర్థన? దయచేసి [open an issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Security issues? [security@puter.com](mailto:security@puter.com)
- Email maintainers at [hi@puter.com](mailto:hi@puter.com)

మీకు ఏవైనా సందేహాలు ఉంటే మీకు సహాయం చేయడానికి మేము ఎల్లప్పుడూ సంతోషిస్తాము. అడగడానికి సంకోచించకండి!

<br/>

## లైసెన్సు

ఈ రిపోజిటరీ, దాని మొత్తం కంటెంట్‌లు, ఉప-ప్రాజెక్ట్‌లు, మాడ్యూల్స్ మరియు కాంపోనెంట్‌లతో సహా, [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) కింద లైసెన్స్‌ని కలిగి ఉంటుంది. . ఈ రిపోజిటరీలో చేర్చబడిన థర్డ్-పార్టీ లైబ్రరీలు వాటి స్వంత లైసెన్స్‌లకు లోబడి ఉండవచ్చు.

<br/>

## అనువాదాలు

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
