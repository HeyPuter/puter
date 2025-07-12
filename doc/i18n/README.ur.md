<h3 align="center"><img width="80" alt="Puter.com, ذاتی کلاؤڈ کمپیوٹر: آپ کی تمام فائلیں، ایپس، اور کھیل ایک جگہ پر، کہیں سے بھی اور کسی بھی وقت قابل رسائی۔" src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">انٹرنیٹ OS! مفت، اوپن سورس، اور خود میزبان.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« لائیو ڈیمو »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">SDK</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">ڈسکورڈ</a>
    ·
    <a href="https://reddit.com/r/puter">ریڈڈٹ</a>
    ·
    <a href="https://twitter.com/HeyPuter">ایکس (ٹوئٹر)</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="اسکرین شاٹ" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

ایک جدید، اوپن سورس انٹرنیٹ آپریٹنگ سسٹم ہے جو کہ خصوصیات سے بھرپور، بہت تیز، اور انتہائی توسیع پذیر ہے۔ Puter

: کو استعمال کیا جا سکتا ہے Puter

- ایک پرائیویسی فرسٹ ذاتی کلاؤڈ کے طور پر تاکہ آپ کی تمام فائلیں، ایپس، اور کھیل ایک محفوظ جگہ پر رکھی جا سکیں، کہیں سے بھی اور کسی بھی وقت قابل رسائی ہوں۔
- ویب سائٹس، ویب ایپس، اور کھیل بنانے اور شائع کرنے کے لئے ایک پلیٹ فارم کے طور پر۔
- وغیرہ کا متبادل، نئے انٹرفیس اور طاقتور خصوصیات کے ساتھ۔ Dropbox، Google Drive، OneDrive
- سرورز اور ورک اسٹیشنز کے لیے ایک ریموٹ ڈیسک ٹاپ ماحول کے طور پر۔
- ویب ڈویلپمنٹ، کلاؤڈ کمپیوٹنگ، تقسیم شدہ نظاموں، اور بہت کچھ سیکھنے کے لیے ایک دوستانہ، اوپن سورس پروجیکٹ اور کمیونٹی!

<br/>

## شروع کرنے کا طریقہ

### 💻 مقامی ترقی

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

یہ Puter کو http://puter.localhost:4100 (یا اگلے دستیاب پورٹ) پر لانچ کرے گا۔

<br/>
🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>
🐙 Docker Compose
Linux/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>
Windows

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

Puter کو [**puter.com**](https://puter.com) پر میزبان سروس کے طور پر دستیاب ہے۔

<br/>

## نظام کی ضروریات

- **آپریٹنگ سسٹمز:** لینکس، macOS، ونڈوز
- **RAM:** کم از کم 2GB (4GB تجویز کردہ)
- **ڈسک کی جگہ:** 1GB خالی جگہ
- **Node.js:** ورژن 16+ (ورژن 22+ تجویز کردہ)
- **npm:** تازہ ترین مستحکم ورژن

<br/>

## سپورٹ

منتظمین اور کمیونٹی سے جڑنے کے لیے یہ چینلز استعمال کریں:

- بگ رپورٹ یا فیچر درخواست؟ براہ کرم [ایک مسئلہ کھولیں](https://github.com/HeyPuter/puter/issues/new/choose).
- ڈسکورڈ: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- ایکس (ٹوئٹر): [x.com/HeyPuter](https://x.com/HeyPuter)
- ریڈڈٹ: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- ماسٹڈون: [mastodon.social/@puter](https://mastodon.social/@puter)
- سیکیورٹی کے مسائل؟ [security@puter.com](mailto:security@puter.com)
- منتظمین کو ای میل کریں [hi@puter.com](mailto:hi@puter.com)

ہم ہمیشہ آپ کی مدد کے لیے خوش ہیں۔ سوالات پوچھنے میں ہچکچاہٹ نہ کریں
!
<br/>

## لائسنس

اس ریپوزٹری، بشمول اس کے تمام مواد، ذیلی پروجیکٹس، ماڈیولز، اور کمپوننٹس، کو [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) کے تحت لائسنس کیا گیا ہے جب تک کہ واضح طور پر کہیں اور نہ کہا گیا ہو۔ اس ریپوزٹری میں شامل تھرڈ پارٹی لائبریریاں اپنی لائسنس کے تابع ہو سکتی ہیں۔

<br/>
