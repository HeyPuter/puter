<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">سیستم‌عامل اینترنت! رایگان، متن‌باز و قابل‌میزبانی خودکار.</h3>

<p align="center">
    <img alt="اندازه مخزن در GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="آخرین نسخه در GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="مجوز در GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« دموی زنده »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">SDK</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">دیسکورد</a>
    ·
    <a href="https://www.youtube.com/@EricsPuterVideos">یوتیوب</a>
    ·
    <a href="https://reddit.com/r/puter">ردیت</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (توییتر)</a>
    ·
    <a href="https://hackerone.com/puter_h1b">Bug Bounty</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="اسکرین‌شات" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## پتر (Puter)

پتر یک سیستم‌عامل اینترنتی پیشرفته و متن‌باز است که با هدف ارائه قابلیت‌های فراوان، سرعت بالا و توسعه‌پذیری بالا طراحی شده است. پتر می‌تواند به‌عنوان موارد زیر استفاده شود:

یک فضای ابری شخصی با اولویت حفظ حریم خصوصی که تمام فایل‌ها، برنامه‌ها و بازی‌های شما را در یک مکان امن نگهداری می‌کند و از هر نقطه و در هر زمانی قابل دسترسی است.
یک پلتفرم برای ساخت و انتشار وب‌سایت‌ها، برنامه‌های وب و بازی‌ها.
جایگزینی برای Dropbox، Google Drive، OneDrive و غیره با یک رابط کاربری جدید و ویژگی‌های قدرتمند.
یک محیط دسکتاپ از راه دور برای سرورها و ایستگاه‌های کاری.
یک پروژه متن‌باز و جامعه‌ای دوستانه برای یادگیری توسعه وب، رایانش ابری، سیستم‌های توزیع‌شده و بیشتر!

<br/>

## شروع به کار

### 💻 توسعه محلی

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

این دستور پتر را در http://puter.localhost:4100 (یا پورت بعدی موجود) راه‌اندازی می‌کند.

<br/>

### 🐳 داکر

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter ghcr.io/heyputer/puter
```

<br/>

### 🐙 Docker Compose

#### لینوکس/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>

#### ویندوز

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

پتر به‌عنوان یک سرویس میزبانی‌شده در [**puter.com**](https://puter.com) در دسترس است.

<br/>

## الزامات سیستم

- **سیستم‌عامل‌ها:** لینوکس، macOS، ویندوز
- **رم:** حداقل ۲ گیگابایت (۴ گیگابایت توصیه می‌شود)
- **فضای دیسک:** ۱ گیگابایت فضای خالی
- **Node.js:** نسخه ۱۶+ (نسخه ۲۲+ توصیه می‌شود)
- **npm:** آخرین نسخه پایدار

<br/>

## پشتیبانی

از طریق این کانال‌ها با نگهدارنده‌ها و جامعه در ارتباط باشید:

- گزارش باگ یا درخواست ویژگی؟ لطفاً [یک issue باز کنید](https://github.com/HeyPuter/puter/issues/new/choose).
- دیسکورد: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- ایکس (توییتر): [x.com/HeyPuter](https://x.com/HeyPuter)
- ردیت: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- مسائل امنیتی؟ [security@puter.com](mailto:security@puter.com)
- به نگهدارنده‌ها ایمیل بزنید: [hi@puter.com](mailto:hi@puter.com)

ما همیشه خوشحال می‌شویم که به سوالات شما پاسخ دهیم. از پرسیدن دریغ نکنید!

<br/>

## مجوز

این مخزن، شامل تمامی محتویات، زیرپروژه‌ها، ماژول‌ها و اجزاء آن، تحت [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) مجوز دارد مگر به طور صریح خلاف آن ذکر شده باشد. کتابخانه‌های شخص ثالث موجود در این مخزن ممکن است تحت مجوزهای خود باشند.

<br/>
