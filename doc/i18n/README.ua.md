<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>
<h3 align="center">Інтернет-ОС! Безкоштовна, відкрита та самостійно-хостована.</h3>

<p align="center">
    <img alt="Розмір репозиторію GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="Випуск GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=остання%20версія"> <img alt="Ліцензія GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« ЖИВИЙ ДЕМО »</strong></a>
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="знімок екрана" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter - це передова, відкрита операційна система Інтернету, яка має багатий функціонал, виняткову швидкість та високу розширюваність. Puter може бути використаний як:

- Особистий хмарний сервіс з підвищеною конфіденційністю, щоб зберігати всі ваші файли, додатки та ігри в безпечному місці, доступному з будь-якого місця та в будь-який час.
- Платформа для створення та публікації веб-сайтів, веб-додатків та ігор.
- Альтернатива Dropbox, Google Drive, OneDrive тощо з новим інтерфейсом та потужними функціями.
- Віддалена робоча область для серверів та робочих станцій.
- Дружній відкритий проект та спільнота для вивчення веб-розробки, хмарних обчислень, розподілених систем та багато іншого!

<br/>

## Початок роботи

### 💻 Локальна розробка

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Це запустить Puter за адресою http://puter.localhost:4100 (або наступний доступний порт).

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

Puter доступний як хостована послуга на [**puter.com**](https://puter.com).

<br/>

## Системні вимоги

- **Операційні системи:** Linux, macOS, Windows
- **Оперативна пам'ять:** Мінімум 2 ГБ (рекомендовано 4 ГБ)
- **Дисковий простір:** 1 ГБ вільного місця
- **Node.js:** Версія 16+ (рекомендовано версію 22+)
- **npm:** Остання стабільна версія

<br/>

## Підтримка

Зв'яжіться з розробниками та спільнотою через ці канали:

- Звіт про помилку або запит функції? Будь ласка, [створіть питання](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Проблеми безпеки? [security@puter.com](mailto:security@puter.com)
- Напишіть розробникам на [hi@puter.com](mailto:hi@puter.com)

Ми завжди раді допомогти вам з будь-якими питаннями. Не соромтеся запитувати!

<br/>

## Ліцензія

Цей репозиторій, включаючи всі його вміст, підпроекти, модулі та компоненти, ліцензовано за [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), якщо не зазначено інше. Сторонні бібліотеки, включені в цей репозиторій, можуть підлягати власним ліцензіям.

<br/>
