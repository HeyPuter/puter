<h3 align="center"><img width="80" alt="Puter.com, Osobisty Komputer Chmurowy: Wszystkie twoje pliki, aplikacje i gry w jednym miejscu, dostępne z dowolnego miejsca o dowolnej porze." src="https://assets.puter.site/puter-logo.png"></h3>
<h3 align="center"> System Operacyjny Internet! Darmowy, Open-Source i Możliwy do Samodzielnego Hostowania.</h3>
<p align="center">
    <img alt="Rozmiar repozytorium GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="Wydanie GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="Licencja GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« DEMO NA ŻYWO »</strong></a>
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
<h3 align="center"><img width="800" style="border-radius:5px;" alt="zrzut ekranu" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>
<br/>

## Puter

Puter to zaawansowany, open-source'owy internetowy system operacyjny, zaprojektowany tak, aby był bogaty w funkcje, wyjątkowo szybki i wysoce rozszerzalny. Puter może być używany jako:

- Prywatna chmura osobista do przechowywania wszystkich plików, aplikacji i gier w jednym bezpiecznym miejscu, dostępnym z dowolnego miejsca o dowolnej porze.
- Platforma do budowania i publikowania stron internetowych, aplikacji webowych i gier.
- Alternatywa dla Dropbox, Google Drive, OneDrive itp. ze świeżym interfejsem i potężnymi funkcjami.
- Zdalne środowisko pulpitu dla serwerów i stacji roboczych.
- Przyjazny, open-source'owy projekt i społeczność do nauki o tworzeniu stron internetowych, chmurze obliczeniowej, systemach rozproszonych i wielu innych!

<br/>

## Rozpoczęcie pracy

## 💻 Lokalne środowisko developerskie

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

To uruchomi Puter na http://puter.localhost:4100 (lub na następnym dostępnym porcie).

<br/>

## 🐳 Docker

```bash
Copy code
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

## 🐙 Docker Compose

## Linux/macOS

```bash
Copy code
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>

## Windows

```powershell
mkdir -p puter
cd puter
New-Item -Path "puter\config" -ItemType Directory -Force
New-Item -Path "puter\data" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml" -OutFile "docker-compose.yml"
docker compose up
```

<br/>

## ☁️ Puter.com

Puter jest dostępny jako usługa hostowana na [**puter.com**](https://puter.com).

<br/>

## Wymagania systemowe

- **Systemy operacyjne:** Linux, macOS, Windows
- **RAM:** Minimum 2GB (zalecane 4GB)
- **Przestrzeń dyskowa:** 1GB wolnego miejsca
- **Node.js:** Wersja 16+ (zalecana wersja 22+)
- **npm:** Najnowsza stabilna wersja

<br/>

## Wsparcie

Skontaktuj się z opiekunami i społecznością przez te kanały:

- Raport o błędzie lub prośba o funkcję? Proszę otworzyć zgłoszenie.
- Discord: discord.com/invite/PQcx7Teh8u
- X (Twitter): x.com/HeyPuter
- Reddit: reddit.com/r/puter/
- Mastodon: mastodon.social/@puter
- Problemy z bezpieczeństwem? security@puter.com
- Email do opiekunów: hi@puter.com

Zawsze chętnie pomożemy Ci z wszelkimi pytaniami, jakie możesz mieć. Nie wahaj się pytać!
<br/>

## Licencja

To repozytorium, w tym cała jego zawartość, podprojekty, moduły i komponenty, jest licencjonowane na podstawie [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), chyba że wyraźnie zaznaczono inaczej. Biblioteki stron trzecich zawarte w tym repozytorium mogą podlegać własnym licencjom.

<br/>
