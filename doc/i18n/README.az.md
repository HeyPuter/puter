<h3 align="center"><img width="80" alt="Puter.com, Şəxsi Bulud Kompüter: Bütün fayllarınız, tətbiqləriniz və oyunlarınız istənilən yerdən, istənilən vaxt əlçatan olan bir yerdə." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">İnternet Əməliyyat Sistemi! Pulsuz, Açıq Mənbəli və Özünüz Yerləşdirə bilərsiniz.</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« CANLI DEMO »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://puter.com/app/app-center">Tətbiq Mağazası</a>
    ·
    <a href="https://developer.puter.com" target="_blank">Developerlər</a>
    ·
    <a href="https://github.com/heyputer/puter-cli" target="_blank">CLI</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="ekran görüntüsü" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter zəngin funksiyalara malik, sürətli və yüksək genişlənə bilən qabaqcıl, açıq mənbəli internet əməliyyat sistemidir. Puter aşağıdakılar üçün istifadə edilə bilər:

- Bütün fayllarınızı, tətbiqlərinizi və oyunlarınızı təhlükəsiz bir yerdə saxlamaq, istənilən yerdən istənilən vaxt əlçatan olan məxfiliyə üstünlük verən şəxsi bulud.
- Vebsaytlar, veb tətbiqləri və oyunlar yaratmaq və nəşr etmək üçün platforma.
- Təravətli interfeys və güclü funksiyalara malik Dropbox, Google Drive, OneDrive və s. alternativ.
- Serverlər və iş stansiyaları üçün uzaq masaüstü mühiti.
- Veb inkişafı, bulud hesablamaları, paylanmış sistemlər və daha çox şey haqqında öyrənmək üçün dostcasına, açıq mənbəli layihə və icma!

<br/>

## Başlanğıc

### 💻 Lokal İnkişaf

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** Bu, Puter-i 
<font color="red"> http://puter.localhost:4100 (və ya növbəti əlçatan portda) işə salmalıdır. </font>

Əgər bu işləməzsə, problem həlli addımları üçün [İlk İşə Salınma Problemləri](./doc/self-hosters/first-run-issues.md) bölməsinə baxın.

<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```
**→** Bu, Puter-i 
<font color="red"> http://puter.localhost:4100 (və ya növbəti əlçatan portda) işə salmalıdır. </font>

<br/>

### 🐙 Docker Compose

#### Linux/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```
**→** Bu, 
<font color="red"> http://puter.localhost:4100 (və ya növbəti əlçatan portda) əlçatan olmalıdır. </font>

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
**→** Bu, Puter-i 
<font color="red"> http://puter.localhost:4100 (və ya növbəti əlçatan portda) işə salmalıdır. </font>

<br/>

### 🚀 Özünüz Yerləşdirmə

Konfiqurasiya variantları və ən yaxşı təcrübələr də daxil olmaqla, Puter-in özünüz tərəfinizdən yerləşdirilməsi üzrə ətraflı bələdçilər üçün [Özünüz Yerləşdirmə Sənədləri](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md) bölməsinə baxın.

<br/>

### ☁️ Puter.com

Puter, [**puter.com**](https://puter.com) ünvanında host edilən xidmət kimi mövcuddur.

<br/>

## Sistem Tələbləri

- **Əməliyyat Sistemləri:** Linux, macOS, Windows
- **RAM:** Minimum 2GB (4GB tövsiyə olunur)
- **Disk Yeri:** 1GB boş yer
- **Node.js:** Versiya 24+
- **npm:** Ən son stabil versiya

<br/>

## Dəstək

Bu kanallar vasitəsilə layihə tərtibatçıları və icma ilə əlaqə saxlayın:

- Xəta hesabatı və ya funksiya tələbi? Zəhmət olmasa [yeni məsələ açın](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Təhlükəsizlik məsələləri? [security@puter.com](mailto:security@puter.com)
- Layihə tərtibatçılarına e-poçt: [hi@puter.com](mailto:hi@puter.com)

Hər hansı sualınızla sizə kömək etməkdən həmişə məmnunuq. Tərəddüd etmədən soruşun!

<br/>

## Lisenziya

Bu repozitoriya, onun bütün məzmunu, alt layihələr, modullar və komponentlər açıq şəkildə başqa cür qeyd edilmədiyi halda [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) lisenziyası altında lisenziyalaşdırılıb. Bu repozitoriyaya daxil edilmiş üçüncü tərəf kitabxanaları öz lisenziyalarına tabe ola bilər.

<br/>

## Tərcümələr

- [Ərəb / العربية](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ar.md)
- [Erməni / Հայերեն](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hy.md)
- [Benqal / বাংলা](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.bn.md)
- [Çin / 中文](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.zh.md)
- [Danimarka / Dansk](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.da.md)
- [İngilis / English](https://github.com/HeyPuter/puter/blob/main/README.md)
- [Fars / فارسی](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fa.md)
- [Fin / Suomi](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fi.md)
- [Fransız / Français](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fr.md)
- [Alman / Deutsch](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.de.md)
- [İvrit / עברית](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.he.md)
- [Hindi / हिंदी](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md)
- [Macar / Magyar](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hu.md)
- [İndoneziya / Bahasa Indonesia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.id.md)
- [İtalyan / Italiano](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.it.md)
- [Yapon / 日本語](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md)
- [Koreya / 한국어](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ko.md)
- [Malay / Bahasa Malaysia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.my.md)
- [Malayalam / മലയാളം](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ml.md)
- [Polyak / Polski](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pl.md)
- [Portuqal / Português](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md)
- [Pəncab / ਪੰਜਾਬੀ](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pa.md)
- [Rumın / Română](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ro.md)
- [Rus / Русский](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ru.md)
- [İspan / Español](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.es.md)
- [İsveç / Svenska](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.sv.md)
- [Tamil / தமிழ்](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ta.md)
- [Teluqu / తెలుగు](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.te.md)
- [Tay / ไทย](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.th.md)
- [Türk / Türkçe](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.tr.md)
- [Ukrayna / Українська](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ua.md)
- [Urdu / اردو](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ur.md)
- [Vyetnam / Tiếng Việt](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.vi.md)

---

Bu tərcümə Puter README sənədinin Azərbaycan dilinə tam tərcüməsidir və layihənin GitHub repozitoriyasında istifadə üçün hazırdır.
