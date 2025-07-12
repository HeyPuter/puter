<h3 align="center"><img width="80" alt="Puter.com، رایانش ابری شخصی: همه فایل‌ها، برنامه‌ها و بازی‌های شما در یک مکان قابل دسترسی از هر جا و در هر زمان." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">سیستم‌عامل اینترنت! رایگان، متن‌باز، و قابل میزبانی شخصی.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« نسخه نمایشی زنده »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">مستندات توسعه‌دهندگان</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">دیسکورد</a>
    ·
    <a href="https://reddit.com/r/puter">ردیت</a>
    ·
    <a href="https://twitter.com/HeyPuter">ایکس (توییتر)</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="عکس صفحه" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## پیوتر

<div dir="rtl">
<p>پیوتر یک سیستم عامل تحت وب پیشرفته‌ی متن‌باز است که به منظور ایجاد ویژگی‌های متنوع، سرعت بسیار بالا، و مقیاس‌پذیری طراحی شده است. از پیوتر می‌توان به‌عنوان:</p>

<ul>
  <li>یک فضای ابری شخصی که بر حریم خصوصی تمرکز دارد و تمام فایل‌ها، برنامه‌ها، و بازی‌های شما را در یک مکان امن ذخیره می‌کند، قابل دسترسی از هر جا و در هر زمان.</li>
  <li>پلتفرمی برای ساخت و انتشار وب‌سایت‌ها، اپلیکیشن‌های وب، و بازی‌ها.</li>
  <li>جایگزینی برای Dropbox، Google Drive، OneDrive، و سایر موارد، با یک رابط کاربری مدرن و قابلیت‌های قدرتمند.</li>
  <li>یک محیط دسکتاپ از راه دور برای سرورها و ایستگاه‌های کاری.</li>
  <li> یک پروژه و جامعه‌ی متن‌باز دوستانه برای یادگیری توسعه وب، رایانش ابری، سیستم‌های توزیع‌شده، و موارد دیگر نام برد!</li>
</ul>
</div>

<br/>

## نحوه‌ی استفاده

### 💻 توسعه‌ی محلی

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

این کار پیوتر را در http://puter.localhost:4100 (یا پورت در دسترس بعدی) اجرا می‌کند.

<br/>

### 🐳 داکر

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

### 🐙 داکر کامپوز

#### لینوکس/مک

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

### ☁️ وبگاه Puter.com

پیوتر به‌عنوان یک سرویس میزبانی‌شده در وبگاه [**puter.com**](https://puter.com) موجود است.

## پیش‌نیازهای سیستم

- **سیستم‌عامل‌ها:** لینوکس، مک، ویندوز
- **RAM** حداقل ۲ گیگابایت (پیشنهاد: ۴ گیگابایت)
- **فضای دیسک:** ۱ گیگابایت فضای خالی
- **Node.js:** نسخه ۱۶+ (پیشنهاد: نسخه ۲۲+)
- **npm:** آخرین نسخه پایدار

<br/>

## پشتیبانی

با مدیران و انجمن از طریق این کانال‌ها در تماس باشید:

- گزارش اشکال یا درخواست ویژگی؟ لطفاً [Isuue باز کنید](https://github.com/HeyPuter/puter/issues/new/choose)
- دیسکورد: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- ایکس (توییتر): [x.com/HeyPuter](https://x.com/HeyPuter)
- ردیت: [/reddit.com/r/puter](https://www.reddit.com/r/puter/)
- ماستودون: [mastodon.social/@puter](https://mastodon.social/@puter)
- مشکلات امنیتی؟ [security@puter.com](mailto:security@puter.com)
- ایمیل مدیران: [hi@puter.com](mailto:hi@puter.com)

ما همیشه از پاسخگویی به سوالات شما خرسند هستیم. در سوال پرسیدن درنگ نکنید!

## گواهی

این مخزن، شامل تمام محتویات، پروژه‌های فرعی، ماژول‌ها و اجزای آن، تحت مجوز [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) است مگر آنکه خلاف آن به‌طور صریح ذکر شده باشد. کتابخانه‌های خارجی ممکن است گواهی‌های جداگانه داشته باشند.

<br/>
