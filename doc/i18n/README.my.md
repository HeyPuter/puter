<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: Semua fail, apl, dan permainan anda di satu tempat yang boleh diakses dari mana sahaja pada bila-bila masa." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Sistem Operasi Internet! Percuma, Sumber Terbuka, dan Boleh Dihoskan Sendiri.</h3>

<p align="center">
    <img alt="Saiz repo GitHub" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="Terbitan GitHub" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="Lesen GitHub" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« DEMO SECARA LANGSUNG »</strong></a>
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

Puter ialah sistem operasi internet sumber terbuka yang maju dan direka untuk kaya dengan ciri kefungsian, kepantasan luar biasa dan kebolehluasan yang tinggi. Puter boleh digunakan sebagai:

- Storan awan peribadi yang mendahulukan privasi untuk menyimpan semua fail, aplikasi dan permainan anda di satu tempat yang selamat dan boleh diakses dari mana sahaja pada bila-bila masa.
- Platform untuk membina dan menerbitkan laman web, aplikasi web dan permainan.
- Alternatif kepada Dropbox, Google Drive, OneDrive, dan lain-lain dengan antara muka yang baharu dan ciri kefungsian berkuasa tinggi.
- Persekitaran desktop awan untuk server dan stesen kerja.
- Projek dan komuniti sumber terbuka yang mesra untuk mempelajari pembangunan laman web, pengkomputeran awan, sistem teragih, dan banyak lagi!

<br/>

## Mulakan


### 💻 Pembangunan Lokal

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Ini akan melancarkan Puter di http://puter.localhost:4100 (atau port seterusnya yang tersedia).

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

### Windows


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

Puter tersedia sebagai perkhidmatan terhos di [**puter.com**](https://puter.com).

<br/>

## Keperluan Sistem

- **Sistem Operasi:** Linux, macOS, Windows
- **RAM:** Minimum 2GB (sebaiknya 4GB)
- **Ruang Storan:** 1GB ruang kosong
- **Node.js:** Versi 16+ (sebaiknya Versi 22+)
- **npm:** Versi stabil yang terkini

<br/>

## Sokongan

Berhubung dengan penyelenggara dan komuniti melalui saluran berikut:

- Laporan pepijat atau permintaan ciri? Sila [buka isu baharu](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Isu keselamatan? [security@puter.com](mailto:security@puter.com)
- Emel penyelenggara melalui [hi@puter.com](mailto:hi@puter.com)

Kami sentiasa gembira untuk membantu anda dengan apa-apa soalan. Jangan takut untuk bertanya!

<br/>


## Lesen

Repositori ini, termasuklah kandungannya, subprojek, modul dan komponen, dilesenkan di bawah [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) melainkan dinyatakan sebaliknya. *Library* pihak ketiga yang terkandung dalam repositori ini tertakluk kepada lesen mereka sendiri.
<!-- The word `Library` is kept as is to avoid confusion since the direct translation `Perpustakaan/Pustaka` is never used in the tech context and doesn't convey the same meaning among Malay community if used in this situation -->
<br/>
