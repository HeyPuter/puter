<h3 align="center"><img width="80" alt="Puter.com, Osobisty Komputer w Chmurze: wszystkie twoje pliki, aplikacje i gry w jednym miejscu, dostępne z każdego miejsca o każdej porze." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Otwartoźródłowy komputer internetowy!</h3>

<p align="center">
    <a href="https://puter.com/"><strong>« DEMO NA ŻYWO »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/">Puter.com</a>
    ·
    <a href="https://office.puter.com/">Office Suite</a>
    ·
    <a href="https://builder.puter.com/">AI Builder</a>
    ·
    <a href="https://developer.puter.com" target="_blank">Dla programistów</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="zrzut ekranu" src="https://assets.puter.com/puter.webp"></h3>

<br/>

## Puter

Puter to zaawansowany, otwartoźródłowy komputer internetowy, który możesz hostować samodzielnie. Został zaprojektowany tak, by oferować bogate funkcje, działać szybko i być w pełni rozszerzalny.

### Dla użytkowników
Celem Putera jest zapewnienie wszystkiego, czego potrzebujesz do pracy, tworzenia i rozrywki, w jednym miejscu. Od prostego [Notepada](https://online-notepad.com) i [Camery](https://online-camera.com) po [Office Suite](https://office.puter.com) i [AI Builder](https://builder.puter.com) — Puter ma być kompletnym rozwiązaniem dla twojego cyfrowego życia.


### Dla programistów

Puter dostarcza wszystko, czego potrzebujesz do tworzenia i publikowania aplikacji webowych oraz gier. Od [AI](https://developer.puter.com/ai/) przez [przechowywanie plików w chmurze](https://developer.puter.com/object-storage/) i [bazę danych](https://developer.puter.com/key-value-database/) po [funkcje serverless](https://developer.puter.com/serverless-workers/) — Puter ma to wszystko. Puter pomaga też zdobywać użytkowników! Po stworzeniu aplikacji możesz opublikować ją w naszym [App Store](https://apps.puter.com/), aby dotrzeć do użytkowników i na niej zarabiać.

<br/>

## Pierwsze kroki


### 💻 Lokalne środowisko programistyczne

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** Powinno to uruchomić Putera pod adresem http://puter.localhost:4100

Aby uruchomić tę kopię repozytorium w Dockerze, skorzystaj z instrukcji [Budowanie ze źródeł](../self-hosting.md#building-from-source-instead-of-pulling). Utwórz lokalny plik `docker-compose.override.yml`, aby wybrać lokalny build. Dzięki temu ustawienia te nie trafiają do `docker-compose.yml`, co pozwala uniknąć konfliktów przy pobieraniu aktualizacji i trzyma lokalną konfigurację poza pull requestami.


<br/>

### 🚀 Samodzielny hosting

#### Linux/macOS

```bash
curl -fsSL https://puter.com/selfhost | sh
```

#### Windows

```powershell
irm https://puter.com/selfhost?os=windows | iex
```

**→** Więcej szczegółów znajdziesz w [Samodzielnym hostowaniu Putera](../self-hosting.md).

<br/>

### ☁️ Puter.com

Puter jest dostępny jako usługa hostowana pod adresem [**puter.com**](https://puter.com).

<br/>

## Wsparcie

Skontaktuj się z opiekunami projektu i społecznością za pośrednictwem tych kanałów:

- Zgłaszasz błąd lub proponujesz nową funkcję? [Utwórz zgłoszenie](https://github.com/HeyPuter/puter/issues/new/choose).
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Problemy z bezpieczeństwem lub zgłoszenia nadużyć? [security@puter.com](mailto:security@puter.com)
- Napisz do opiekunów pod adresem [hi@puter.com](mailto:hi@puter.com)

Chętnie pomożemy w każdej sprawie. Śmiało pytaj!

<br/>

## Licencja

To repozytorium, wraz z całą zawartością, podprojektami, modułami i komponentami, jest udostępniane na licencji [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), o ile wyraźnie nie zaznaczono inaczej. Biblioteki zewnętrzne dołączone do tego repozytorium mogą podlegać własnym licencjom.

<br/>

## Tłumaczenia

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
