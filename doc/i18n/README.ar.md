<h3 align="center"><img width="80" alt="Puter.com، الحاسوب السحابي الشخصي: جميع ملفاتك وتطبيقاتك وألعابك في مكان واحد يمكن الوصول إليه من أي مكان في أي وقت." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">نظام تشغيل الإنترنت! مجاني ومفتوح المصدر وقابل للاستضافة الذاتية.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« عرض توضيحي مباشر »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">مجموعة أدوات التطوير</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">ديسكورد</a>
    ·
    <a href="https://www.youtube.com/@EricsPuterVideos">يوتيوب</a>
    ·
    <a href="https://reddit.com/r/puter">ريديت</a>
    ·
    <a href="https://twitter.com/HeyPuter">إكس (تويتر)</a>
    ·
    <a href="https://hackerone.com/puter_h1b">مكافأة اكتشاف الثغرات</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="لقطة شاشة" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## بيوتر

<div dir="rtl">
<p>بيوتر هو نظام تشغيل إنترنت متقدم ومفتوح المصدر، مصمم ليكون غنيًا بالميزات وسريعًا بشكل استثنائي وقابلًا للتوسع بدرجة كبيرة. يمكن استخدام بيوتر كـ:</p>

<ul>
  <li>سحابة شخصية تعطي الأولوية للخصوصية لحفظ جميع ملفاتك وتطبيقاتك وألعابك في مكان آمن واحد، يمكن الوصول إليه من أي مكان وفي أي وقت.</li>
  <li>منصة لبناء ونشر المواقع الإلكترونية وتطبيقات الويب والألعاب</li>
  <li>بديل لـ Dropbox وGoogle Drive وOneDrive وغيرها، مع واجهة جديدة وميزات قوية.</li>
  <li>بيئة سطح مكتب عن بُعد للخوادم ومحطات العمل.</li>
  <li>مشروع ومجتمع ودود ومفتوح المصدر للتعلم عن تطوير الويب والحوسبة السحابية والأنظمة الموزعة والكثير غير ذلك!</li>
</ul>
</div>

<br/>

## البدء

### 💻 التطوير المحلي

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

سيؤدي هذا إلى تشغيل Puter على http://puter.localhost:4100 (أو المنفذ التالي المتاح).

<br/>

### 🐳 دوكر

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

### 🐙 دوكر كومبوز

#### لينكس/ماك

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>

#### ويندوز

```powershell
mkdir -p puter
cd puter
New-Item -Path "puter\config" -ItemType Directory -Force
New-Item -Path "puter\data" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml" -OutFile "docker-compose.yml"
docker compose up
```

<br/>

### ☁️ موقع Puter.com

متاح Puter كخدمة مستضافة على[**puter.com**](https://puter.com)الموقع

<br/>

## متطلبات النظام

- **Operating Systems:** لينكس، ماك، ويندوز
- **RAM** ٢ جيجابايت كحد أدنى (يوصى بـ ٤ جيجابايت)
- **Disk Space:** ١ جيجابايت مساحة حرة
- **Node.js:** الإصدار ١٦+ (يوصى بالإصدار ٢٢+)
- **npm:** أحدث إصدار مستقر

<br/>

## الدعم

تواصل مع المشرفين والمجتمع من خلال هذه القنوات:

- تقرير عن خطأ أو طلب ميزة؟ الرجاء [فتح مشكلة](https://github.com/HeyPuter/puter/issues/new/choose)

- دسكورد: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- إكس (تويتر): [x.com/HeyPuter](https://x.com/HeyPuter)
- ريديت: [/reddit.com/r/puter](https://www.reddit.com/r/puter/)
- ماستودون: [mastodon.social/@puter](https://mastodon.social/@puter)
- مشاكل أمنية؟ [security@puter.com](mailto:security@puter.com)
- البريد الإلكتروني للمشرفين [hi@puter.com](mailto:hi@puter.com)

نحن دائمًا سعداء لمساعدتك في أي أسئلة قد تكون لديك. لا تتردد في السؤال!

<br/>

## الترخيص

هذا المستودع، بما في ذلك جميع محتوياته ومشاريعه الفرعية ووحداته ومكوناته، مرخص تحت [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) ما لم ينص على خلاف ذلك صراحةً. قد تخضع المكتبات الخارجية المدرجة في هذا المستودع لتراخيصها الخاصة.

<br/>
