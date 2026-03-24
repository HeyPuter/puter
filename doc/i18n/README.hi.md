<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: आपकी सारी फाइलें, ऐप्स, और गेम एक ही जगह, जिसे कहीं से भी कभी भी एक्सेस किया जा सकता है।" src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">इंटरनेट ओएस! फ्री, ओपन-सोर्स, और सेल्फ-होस्टेबल।</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« लाइव डेमो »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://apps.puter.com/">ऐप स्टोर</a>
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

## Puter क्या है?

Puter एक एडवांस्ड, ओपन-सोर्स इंटरनेट ऑपरेटिंग सिस्टम है जिसे फीचर-रिच, तेज़ और एक्सटेंडेबल बनाने के लिए डिज़ाइन किया गया है। Puter का उपयोग आप निम्नलिखित चीजों के लिए कर सकते हैं:

- एक प्राइवेसी-फर्स्ट पर्सनल क्लाउड, जो आपकी सभी फाइलों, ऐप्स और गेम्स को एक सेफ जगह पर रखता है, जिसे आप कहीं से भी कभी भी एक्सेस कर सकते हैं।
- वेबसाइट्स, वेब ऐप्स और गेम्स बनाने और पब्लिश करने का एक प्लेटफ़ॉर्म।
- Dropbox, Google Drive, OneDrive आदि का एक शानदार और पावरफुल इंटरफ़ेस वाला विकल्प।
- सर्वर और वर्कस्टेशन के लिए एक रिमोट डेस्कटॉप एनवायरनमेंट।
- एक फ्रेंडली ओपन-सोर्स प्रोजेक्ट और कम्युनिटी, जहां आप वेब डेवलपमेंट, क्लाउड कंप्यूटिंग, डिस्ट्रीब्यूटेड सिस्टम्स और बहुत कुछ सीख सकते हैं।

<br/>

## शुरुआत कैसे करें?

### 💻 लोकल डेवलपमेंट

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

✨ यह Puter को  
<font color="red"> http://puter.localhost:4100 </font> (या अगले उपलब्ध पोर्ट) पर लॉन्च करेगा।


अगर यह काम नहीं करता, तो [First Run Issues](./doc/self-hosters/first-run-issues.md) देखें।


<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

✨ यह Puter को 
<font color="red"> http://puter.localhost:4100</font> (या अगले उपलब्ध पोर्ट) पर लॉन्च करेगा।

<br/>

### 🐙 Docker Compose

#### Linux/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

✨ यह <font color="red"> http://puter.localhost:4100  </font>
 (या अगले उपलब्ध पोर्ट) पर उपलब्ध होगा।

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

✨ यह Puter को 
<font color="red"> http://puter.localhost:4100 (or the next available port). </font> (या अगले उपलब्ध पोर्ट) पर लॉन्च करेगा।

<br/>

### 🚀 सेल्फ-होस्टिंग

सेल्फ-होस्टिंग के लिए विस्तृत गाइड, कॉन्फ़िगरेशन ऑप्शन्स और बेस्ट प्रैक्टिसेज जानने के लिए हमारी [Self-Hosting Documentation](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md) देखें।

<br/>

### ☁️ Puter.com

Puter [**puter.com**](https://puter.com) पर एक होस्टेड सर्विस के रूप में भी उपलब्ध है।

<br/>

## सिस्टम आवश्यकताएँ

* **ऑपरेटिंग सिस्टम्स:** Linux, macOS, Windows
* **RAM:** कम से कम 2GB (4GB रिकमेंडेड)
* **डिस्क स्पेस:** 1GB फ्री स्पेस
* **Node.js:** वर्जन 16+ (वर्जन 23+ रिकमेंडेड)
* **npm:** लेटेस्ट स्टेबल वर्जन

<br/>

## सपोर्ट

नीचे दिए गए माध्यमों से आप मेंटेनर्स और कम्युनिटी से जुड़ सकते हैं:

* बग रिपोर्ट या फीचर रिक्वेस्ट? [यहाँ issue खोलें](https://github.com/HeyPuter/puter/issues/new/choose)।
* Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
* X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
* Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
* Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
* सिक्योरिटी इशूज़? [security@puter.com](mailto:security@puter.com)
* ईमेल करें: [hi@puter.com](mailto:hi@puter.com)

आपके किसी भी सवाल में मदद करने के लिए हम हमेशा तैयार हैं!

<br/>

## लाइसेंस

यह रिपॉज़िटरी और इसके सभी कंटेंट्स [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) लाइसेंस के अंतर्गत आते हैं जब तक कि कुछ और स्पष्ट रूप से ना लिखा हो। इसमें शामिल थर्ड-पार्टी लाइब्रेरीज़ अपने-अपने लाइसेंस के अधीन हो सकती हैं।

<br/>

## अनुवाद

Puter के डॉक्यूमेंटेशन कई भाषाओं में उपलब्ध हैं, जिनमें शामिल हैं:

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

