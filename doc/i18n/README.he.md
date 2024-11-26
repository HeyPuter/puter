<h3 align="center"><img width="80" alt="Puter.com, 
הענן הפרטי: כל הקבצים, האפליקציות והמשחקים שלך במקום אחד נגיש מכל מקום ובכל זמן." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center" dir="rtl">מערכת ההפעלה של האינטרנט! חינמית, קוד פתוח וניתנת לאחסון עצמאי.</h3>

<p align="center">
    <img alt="GitHub גודל ספרית" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub גרסא" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub רישיון" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« הדגמה לייב »</strong></a>
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
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="צילום מסך" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

<div dir="rtl">
    <p div="rtl">
    מערכת ההפעלה Puter הינה ספרית קוד פתוח, מתקדמת, עשירה בתכנים, מהירה במיוחד וניתנת להרחבה.
    אפשר להישתמש ב Puter כ:</p>
    <ul>
        <li>ענן אישי עם פרטיות מקסימלית, לשמירת הקבצים, האפליקציות והמשחקים שלך במקום מאובטח אחד, נגיש מכל מקום ובכל זמן.</li>
        <li>פלטפורמה לבניית ופרסום אתרים, אפליקציות ומשחקים.</li>
        <li>אלטרנטיבה ל-Dropbox, Google Drive, OneDrive וכו' עם ממשק מרענן ותכנים חזקים.</li>
        <li>סביבה לעבודה מרחוק לשרתים ותחנות עבודה.</li>
        <li>פרוייקט ידידותי, קוד פתוח וקהילה ללמידה על פיתוח אינטרנט, פיתוח בענן, מערכות מבוזרות ועוד הרבה!</li>
    <ul>
</div>

<br/>

## בוא נתחיל

### 💻 פיתוח מקומי (Localhost)

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

פקודה זו תפעיל את Puter בכתובת http://puter.localhost:4100 (או בפורט הפנוי הבא).

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

מערכת ההפעלה Puter זמינה כשירות אחסון ב- [**puter.com**](https://puter.com).

<br/>

## דרישות מערכת

- **מערכות הפעלה:** Linux, macOS, Windows
- **RAM:** לפחות 2GB, מומלץ 4GB
- **מקום פנוי בדיסק:** 1GB
- **Node.js:** גרסה 16+ (מומלץ גרסה 22+)
- **npm:** הגרסה היציבה האחרונה

<br/>

## תמיכה

צור קשר עם המפתחים והקהילה דרך הערוצים הבאים:

- דיווח על באג או בקשה לתוכן? אנא [פתח פניה](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter](https://www.reddit.com/r/puter.)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- בעיות אבטחה? [security@puter.com](mailto:security@puter.com)
- שלח אימייל למפתחים ב [hi@puter.com](mailto:hi@puter.com)

אנחנו תמיד שמחים לעזור עם כל שאלה שיש. אל תהסס לשאול!

<br/>

## רישיון

ספריה זו, כולל כל התכנים שלה, תתי הפרויקטים, המודולים והרכיבים שלה, מורשית תחת [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) אלא אם נאמר אחרת במפורש. לספריות צד שלישי הכלולות בספרייה זו עשויות להיות רישיונות משלהן.

<br/>
