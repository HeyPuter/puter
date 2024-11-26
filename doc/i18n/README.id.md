<h3 align="center"><img width="80" alt="Puter.com, Komputer Cloud Pribadi: Semua file, aplikasi, dan permainan Anda berada di satu tempat yang dapat diakses dari mana saja kapan saja." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Sistem Operasi Internet! Gratis, Sumber Terbuka, dan Dapat Dihosting Sendiri.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« LIVE DEMO »</strong></a>
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

Puter adalah sistem operasi internet canggih, open-source, yang dirancang untuk menjadi kaya fitur, sangat cepat, dan sangat dapat diperluas. Puter dapat digunakan sebagai:

- Cloud pribadi yang mengutamakan privasi untuk menyimpan semua file, aplikasi, dan permainan Anda di satu tempat yang aman, yang dapat diakses dari mana saja kapan saja.
- Platform untuk membangun dan mempublikasikan situs web, aplikasi web, dan permainan.
- Alternatif untuk Dropbox, Google Drive, OneDrive, dll. Dengan antarmuka baru dan fitur-fitur canggih.
- Lingkungan desktop jarak jauh untuk server dan workstation.
- Proyek dan komunitas open-source yang ramah untuk belajar tentang pengembangan web, komputasi gemawan (cloud), sistem terdistribusi, dan banyak lagi!

<br/>

## Memulai


### 💻 Pengembangan Lokal

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Ini akan menjalankan Puter di http://puter.localhost:4100 (atau di port berikutnya yang tersedia)

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

Puter tersedia sebagai layanan yang telah dihosting di [**puter.com**](https://puter.com).

<br/>

## Persyaratan Sistem

- **Sistem Operasi:** Linux, macOS, Windows
- **RAM:** 2GB minimal (rekomendasi 4GB)
- **Penyimpanan:** 1GB ruang tersedia
- **Node.js:** Version 16+ (rekomendasi versi 22+)
- **npm:** Versi stabil termutakhir

<br/>

## Dukuangan

Terhubung dengan maintainer dan komunitas melalui saluran-saluran berikut:

- Laporan bug atau permintaan fitur? Silakan [buat issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Isu keamanan? [security@puter.com](mailto:security@puter.com)
- Email maintainers di [hi@puter.com](mailto:hi@puter.com)

Kami selalu senang membantu Anda dengan pertanyaan apa pun yang Anda miliki. Jangan ragu untuk bertanya!

<br/>


##  Lisensi

Repositori ini, termasuk semua isinya, sub-proyek, modul, dan komponen, dilisensikan di bawah [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) kecuali dinyatakan sebaliknya secara eksplisit. Perpustakaan pihak ketiga yang termasuk dalam repositori ini mungkin tunduk pada lisensinya sendiri.

<br/>
