<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">ระบบปฏิบัติการอินเทอร์เน็ต ฟรี, โอเพ่นซอร์ส, และสามารถโฮสต์ได้ด้วยตนเอง</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« การสาธิตสด »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">ชุดพัฒนาโปรแกรม</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">ดิสคอร์ด</a>
    ·
    <a href="https://reddit.com/r/puter">เรดดิท</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (ทวิตเตอร์)</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## พิวเตอร์

พิวเตอร์ เป็นระบบปฏิบัติการอินเทอร์เน็ตขั้นสูงแบบโอเพ่นซอร์สที่ออกแบบมาให้มีฟีเจอร์ครบถ้วน ความเร็วสูง และมีความสามารถที่จะขยายได้สูง. พิวเตอร์ สามารถใช้ได้เป็น:

- คลาวด์ส่วนตัว เพื่อเก็บไฟล์, แอพพลิเคชัน, และเกมทั้งหมดของคุณในที่เดียวที่ปลอดภัยและสามารถเข้าถึงได้ทุกที่ทุกเวลา
- แพลตฟอร์มสำหรับการสร้างและเผยแพร่เว็บไซต์, เว็บแอปพลิเคชัน, และเกม
- ทางเลือกอีกหนึ่งทางที่สามารถใช้แทน Dropbox, Google Drive, OneDrive ฯลฯ โดยที่มีอินเทอร์เฟซใหม่และฟีเจอร์ที่ทรงพลัง
- สภาพแวดล้อมสำหรับเดสก์ท็อประยะไกลที่ใช้กับเซิร์ฟเวอร์และสถานีทำงาน
- โครงการโอเพ่นซอร์สและชุมชนที่เป็นมิตรที่คุณสามารถเรียนรู้เกี่ยวกับการพัฒนาเว็บ, คลาวด์คอมพิวติ้ง, ระบบกระจาย, และอีกมากมาย

<br/>

## การเริ่มต้นใช้งาน

### 💻 การพัฒนาภายในเครื่อง

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

พิวเตอร์ จะถูกเปิดใช้งานที่ http://puter.localhost:4100 (หรือพอร์ตถัดไปที่ว่าง).

<br/>

### 🐳 ด็อกเกอร์

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

### 🐙 ด็อกเกอร์ คอมโพส

#### ลินุกซ์/แมคโอเอส

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>

#### วินโดวส์

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

สามารถใช้งาน พิวเตอร์ ได้ในรูปแบบบริการโฮสต์ที่ [**puter.com**](https://puter.com).

<br/>

## ข้อกำหนดของระบบ

- **ระบบปฏิบัติการ:** ลินุกซ์ แมคโอเอส วินโดวส์
- **แรม:** อย่างน้อย 2GB (แนะนำ 4GB)
- **พื้นที่เก็บข้อมูล:** พื้นที่ว่าง 1GB
- **Node.js:** เวอร์ชัน 16+ (แนะนำเวอร์ชัน 22+)
- **npm:** เวอร์ชันล่าสุดที่เสถียร

<br/>

## การช่วยเหลือ

ติดต่อกับผู้ดูแลระบบและชุมชนผ่านช่องทางเหล่านี้:

- พบข้อผิดพลาดหรือขอฟีเจอร์ใหม่? กรุณา [เปิดปัญหา](https://github.com/HeyPuter/puter/issues/new/choose).
- ดิสคอร์ด: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (ทวิตเตอร์): [x.com/HeyPuter](https://x.com/HeyPuter)
- เรดดิท: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- มาสตอดอน: [mastodon.social/@puter](https://mastodon.social/@puter)
- ปัญหาด้านความปลอดภัย [security@puter.com](mailto:security@puter.com)
- ส่งอีเมลถึงผู้ดูแลระบบได้ที่ [hi@puter.com](mailto:hi@puter.com)

เรายินดีเสมอที่จะช่วยเหลือคุณกับทุกทุกคำถามที่คุณมี อย่าลังเลที่จะถาม

<br/>

## ลิขสิทธิ์

ที่เก็บข้อมูลนี้ รวมถึงเนื้อหาทั้งหมด, โครงการย่อย, โมดูล, และส่วนประกอบต่างๆ ได้รับใบอนุญาตภายใต้ [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) เว้นแต่จะมีการระบุไว้เป็นอย่างอื่นอย่างชัดเจน ไลบรารีจากบุคคลที่สามที่รวมอยู่ในที่เก็บข้อมูลนี้อาจอยู่ภายใต้ใบอนุญาตของตนเอง

<br/>
