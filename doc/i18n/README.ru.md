<h3 align="center"><img width="80" alt="Puter.com, персональный облачный компьютер: все ваши файлы, приложения и игры в одном месте, доступные из любой точки мира в любое время." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Интернет ОС! Бесплатная, с открытым исходным кодом и возможностью самостоятельной установки.</h3>

<p align="center">
    <img alt="Размер репозитория GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="Релиз GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="Лицензия GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« ЖИВОЕ ДЕМО »</strong></a>
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

<h3 align="center"><img width="800" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter — это передовая операционная система с открытым исходным кодом, разработанная для обеспечения широкого функционала, исключительной скорости и высокой масштабируемости. Puter можно использовать как:

- Персональное облако с приоритетом конфиденциальности для хранения всех ваших файлов, приложений и игр в одном безопасном месте, доступном из любой точки мира в любое время.
- Платформа для создания и публикации веб-сайтов, веб-приложений и игр.
- Альтернатива Dropbox, Google Drive, OneDrive и т. д. с новым интерфейсом и мощными функциями.
- Удаленное рабочее окружение для серверов и рабочих станций.
- Дружественный проект с открытым исходным кодом и сообщество для изучения веб-разработки, облачных вычислений, распределенных систем и многого другого!

<br/>

## Начало работы

### 💻 Локальная разработка

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Это запустит Puter по адресу http://puter.localhost:4100 (или на следующем доступном порту).

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

Puter доступен как облачный сервис на [**puter.com**](https://puter.com).

<br/>

## Системные требования

- **Операционные системы:** Linux, macOS, Windows
- **ОЗУ:** минимум 2 ГБ (рекомендуется 4 ГБ)
- **Место на диске:** 1 ГБ свободного места
- **Node.js:** Версия 16+ (рекомендуется версия 22+)
- **npm:** Последняя стабильная версия

<br/>

## Поддержка

Свяжитесь с разработчиками и сообществом этими способами:

- Отчет об ошибке или запрос функции? Пожалуйста, [откройте вопрос](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Проблемы безопасности? [security@puter.com](mailto:security@puter.com)
- Свяжитесь с разработчиками по адресу [hi@puter.com](mailto:hi@puter.com)

Мы всегда рады помочь вам с любыми вопросами. Не стесняйтесь спрашивать!

<br/>

## Лицензия

Этот репозиторий, включая все его содержимое, подпроекты, модули и компоненты, лицензирован в соответствии с [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), если явно не указано иное. Сторонние библиотеки, включенные в этот репозиторий, могут подпадать под действие их собственных лицензий.

<br/>
