<h3 align="center"><img width="80" alt="Puter.com, персональный облачный компьютер: все ваши файлы, приложения и игры в одном месте, доступные из любой точки мира в любое время." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Интернет-компьютер с открытым исходным кодом!</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« ЖИВОЕ ДЕМО »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://office.puter.com/">Office Suite</a>
    ·
    <a href="https://builder.puter.com/">AI Builder</a>
    ·
    <a href="https://developer.puter.com" target="_blank">Разработчикам</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="скриншот" src="https://assets.puter.com/puter-screenshot.webp"></h3>

<br/>

## Puter

Puter — это передовой интернет-компьютер с открытым исходным кодом, который можно развернуть на собственном сервере. Он создан, чтобы быть функциональным, быстрым и легко расширяемым.

### Для пользователей
Цель Puter — дать вам всё необходимое для работы, творчества и развлечений в одном месте. От простых [Notepad](https://online-notepad.com) и [Camera](https://online-camera.com) до [Office Suite](https://office.puter.com) и [AI Builder](https://builder.puter.com) — Puter стремится стать универсальным решением для вашей цифровой жизни.


### Для разработчиков

Puter предоставляет всё необходимое для создания и публикации веб-приложений и игр. От [ИИ](https://developer.puter.com/ai/) до [облачного хранилища](https://developer.puter.com/object-storage/), [базы данных](https://developer.puter.com/key-value-database/) и [serverless-воркеров](https://developer.puter.com/serverless-workers/) — в Puter есть всё. Puter также помогает привлекать пользователей! Создав приложение, вы можете опубликовать его в нашем [App Store](https://apps.puter.com/), чтобы найти пользователей и зарабатывать на них.

<br/>

## Начало работы


### 💻 Локальная разработка

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** После этого Puter запустится по адресу http://puter.localhost:4100

Чтобы запустить этот клон репозитория в Docker, следуйте инструкции [Building from source](../self-hosting.md#building-from-source-instead-of-pulling). Создайте локальный файл `docker-compose.override.yml`, чтобы выбрать локальную сборку. Если держать эти настройки вне `docker-compose.yml`, не будет конфликтов при получении обновлений, а локальная конфигурация не попадёт в pull request.


<br/>

### 🚀 Самостоятельный хостинг

#### Linux/macOS

```bash
curl -fsSL https://puter.com/selfhost | sh
```

#### Windows

```powershell
irm https://puter.com/selfhost?os=windows | iex
```

**→** Подробности смотрите в разделе [Самостоятельный хостинг Puter](../self-hosting.md).

<br/>

### ☁️ Puter.com

Puter доступен как облачный сервис на [**puter.com**](https://puter.com).

<br/>

## Поддержка

Свяжитесь с мейнтейнерами и сообществом через эти каналы:

- Нашли баг или хотите предложить новую функцию? [Создайте issue](https://github.com/HeyPuter/puter/issues/new/choose).
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Проблемы с безопасностью или жалобы на злоупотребления? [security@puter.com](mailto:security@puter.com)
- Напишите мейнтейнерам на [hi@puter.com](mailto:hi@puter.com)

Мы всегда рады помочь с любыми вопросами. Не стесняйтесь спрашивать!

<br/>

## Лицензия

Этот репозиторий, включая всё его содержимое, подпроекты, модули и компоненты, распространяется по лицензии [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), если явно не указано иное. Сторонние библиотеки, входящие в этот репозиторий, могут распространяться по собственным лицензиям.

<br/>

## Переводы

- [Arabic / العربية](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ar.md)
- [Armenian / Հայերեն](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hy.md)
- [Bengali / বাংলা](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.bn.md)
- [Chinese / 中文](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.zh.md)
- [Danish / Dansk](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.da.md)
- [English](https://github.com/HeyPuter/puter/blob/main/README.md)
- [Farsi / فارسی](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fa.md)
- [Finnish / Suomi](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fi.md)
- [French / Français](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fr.md)
- [German /  Deutsch](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.de.md)
- [Hebrew/ עברית](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.he.md)
- [Hindi / हिंदी](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md)
- [Hungarian / Magyar](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hu.md)
- [Indonesian / Bahasa Indonesia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.id.md)
- [Italian / Italiano](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.it.md)
- [Japanese / 日本語](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md)
- [Korean / 한국어](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ko.md)
- [Malay / Bahasa Malaysia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.my.md)
- [Malayalam / മലയാളം](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ml.md)
- [Dutch / Nederlands](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.nl.md)
- [Polish / Polski](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pl.md)
- [Odia / ଓଡ଼ିଆ](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.od.md)
- [Portuguese / Português](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md)
- [Punjabi / ਪੰਜਾਬੀ](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pa.md)
- [Romanian / Română](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ro.md)
- [Russian / Русский](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ru.md)
- [Spanish / Español](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.es.md)
- [Swedish / Svenska](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.sv.md)
- [Tamil / தமிழ்](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ta.md)
- [Telugu / తెలుగు](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.te.md)
- [Thai / ไทย](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.th.md)
- [Turkish / Türkçe](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.tr.md)
- [Ukrainian / Українська](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ua.md)
- [Urdu / اردو](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ur.md)
- [Vietnamese / Tiếng Việt](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.vi.md)
