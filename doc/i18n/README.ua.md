<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: Всі ваші файли, додатки та ігри в одному місці, доступні з будь-якого куточка світу в будь-який час." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Інтернет ОС! Безкоштовна, відкрита та self-hosted.</h3>

<p align="center">
    <img alt="Розмір репозиторію на GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="Остання версія на GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="Ліцензія GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« Онлайн ДЕМО »</strong></a>
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="скріншот" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter — це просунута, інтернет-ОС, з відкритим кодом, створена для того, щоб бути багатофункціональною, надзвичайно швидкою та розширюваною. Puter може використовуватися як:

- Приватний хмарний сервіс для збереження всіх ваших файлів, додатків і ігор у безпечному місці, доступному в будь-який час з будь-якого місця.
- Платформа для створення та публікації вебсайтів, вебдодатків і ігор.
- Альтернатива Dropbox, Google Drive, OneDrive і тд, з свіженьким інтерфейсом та потужними функціями.
- Віддалене робоче середовище для серверів і робочих станцій.
- Дружній, відкритий проєкт та спільнота для вивчення веброзробки, хмарних обчислень, розподілених систем і багато іншого!

<br/>

## Початок роботи

### Локальна розробка

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Це запустить Puter на http://puter.localhost:4100 (або на наступному доступному порті).

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

Puter доступний як hosted service на [**puter.com**](https://puter.com).

<br/>

## Системні вимоги

- **Операційні Системи:** Linux, macOS, Windows
- **RAM:** 2GB мінімум (4GB рекомендовано)
- **Місце на диску:** 1GB вільного місця
- **Node.js:** Version 16+ (Version 22+ рекомендовано)
- **npm:** остання "stable" версія

<br/>

## Підтримка

Зв'язатися з розробниками та спільнотою можна через такі канали:

- Повідомити про помилку, або запит щодо нової фічі? Будь ласка, [створіть issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Питання щодо Security? [security@puter.com](mailto:security@puter.com)
- Написати розробникам [hi@puter.com](mailto:hi@puter.com)

Ми завжди готові допомогти Вам з будь-якими питаннями, що можуть виникнути. Не соромтеся ставити нам питання!
<br/>

## License

Цей репорзиторій, включаючи увесь його контент, дочірні проєкти, модулі, і компоненти, ліцензовано за [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), якщо явно не вказано інше. Сторонні бібліотеки, включені в цей репозиторій, можуть підпадати під дію інших ліцензій.

<br/>
