<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">इंटरनेट ओएस! मुफ्त, ओपन-सोर्स, अउ खुद ले होस्ट करे लइक.</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« LIVE DEMO »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://puter.com/app/app-center">App Store</a>
    ·
    <a href="https://developer.puter.com" target="_blank">डेवलपर्स</a>
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

Puter एक आधुनिक, ओपन-सोर्स इंटरनेट ऑपरेटिंग सिस्टम आय जेकर बनावट फिचर-रिच, तेज, अउ बहुतेकर विस्तार लइक आय। Puter ला ए तरीकें उपयोग कर सकथो:

- एक प्राइवेसी-फर्स्ट पर्सनल क्लाउड जिहां तुमन अपन सबो फाइल, एप्स, अउ गेम एके ठेहा म रख सकथो, अउ कहीं घलो ले पहुँच सकथो।
- वेबसाइट, वेब एप्स, अउ गेम बनाय अउ प्रकाशित करइ बर प्लेटफार्म।
- Dropbox, Google Drive, OneDrive वगैरह के विकल्प — ताजा इंटरफेस अउ जोरदार फीचर संग।
- सर्वर अउ वर्कस्टेशन बर दूर के डेस्कटॉप परिवेश।
- वेब डेवलपमेंट, क्लाउड कम्प्यूटिंग, डिस्ट्रिब्यूटेड सिस्टम म सिक्खे बर एक दोस्ताना ओपन-सोर्स प्रोजेक्ट अउ समुदाय।

<br/>

## शुरू करइया

### 💻 लोकल डिवेलपमेंट

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** ये कमांड Puter ला चालू कर देही  
<font color="red"> http://puter.localhost:4100 (या अगो अगला उपलब्ध पोर्ट). </font>

अगर ये काम नई करे, त [First Run Issues](./doc/self-hosters/first-run-issues.md) देखव — ओमा ट्रबलशूटिंग कदम बताय हे।

<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```
**→** ये कमांड Puter ला चालू कर देही  
<font color="red"> http://puter.localhost:4100 (या अगो अगला उपलब्ध पोर्ट). </font>

<br/>

### 🐙 Docker Compose

#### Linux/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```
**→** ये उपलब्द हो जाही  
<font color="red"> http://puter.localhost:4100 (या अगो अगला उपलब्ध पोर्ट). </font>

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
**→** ये कमांड Puter ला चालू कर देही  
<font color="red"> http://puter.localhost:4100 (या अगो अगला उपलब्ध पोर्ट). </font>

<br/>

### 🚀 खुदे होस्ट करना (Self-Hosting)

Puter ला खुदे होस्ट करे बर पूरा गाइड, कॉन्‍फिगरेशन ऑप्शन अउ बेस्ट-प्रैक्टिस देखे बर [Self-Hosting Documentation](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md) म जाव।

<br/>

### ☁️ Puter.com

Puter ह होस्टेड सर्विस रूप म भी मिलथे: [**puter.com**](https://puter.com)।

<br/>

## सिस्टम के जरूरी चीज

- **ऑपरेटिंग सिस्टम:** Linux, macOS, Windows  
- **RAM:** 2GB न्यूनतम (4GB सिफारिश)  
- **डिस्क स्पेस:** 1GB खाली जगह  
- **Node.js:** Version 20.19.5+ (Version 23+ सिफारिश)  
- **npm:** लेटेस्ट स्टेबल वर्शन

<br/>

## सहायता (Support)

मैनेजर्स अउ समुदाय संगे जुड़व:

- बग रिपोर्ट या फीचर रिक्वेस्ट? कृपा करके [एक इश्यू खोलव](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- सुरक्षा संबंधी समस्या? लिखव: [security@puter.com](mailto:security@puter.com)
- मेंटेनेर्स ला ईमेल: [hi@puter.com](mailto:hi@puter.com)

हमन हमेशा मदद करे बर तैयार हन — कउनो सवाल होवय त पूछव!

<br/>

## लाइसेंस

ये रिपॉजिटरी, ओकर सब्बो कंटेंट, सब-प्रोजेक्ट, मॉड्यूल अउ कंपोनेंट AGPL-3.0 के अंतर्गत लाइसेंस्ड आय जब तक अलग से कहे नई गे हे। तेसर-पार्टी लाइब्रेरी मन के अपन-अपन लाइसेंस हो सकथे।

<br/>

## अनुवाद (Translations)

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

## अउ दूसर README मन के लिंक
### Backend
- [PuterAI Module](./src/backend/doc/modules/puterai/README.md)
- [Metering Service](./src/backend/src/services/MeteringService/README.md)
- [Extensions Development Guide](./extensions/README.md)
