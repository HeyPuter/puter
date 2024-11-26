<h3 align="center"><img width="80" alt="Puter.com, Kişisel Bulut Bilgisayar: Tüm dosyalarınız, uygulamalarınız ve oyunlarınız her zaman her yerden erişilebilen tek bir yerde." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">İnternet İşletim Sistemi! Ücretsiz, Açık Kaynaklı ve Kendi Kendine Barındırılabilir</h3>

<p align="center">
    <img alt="GitHub Depo Boyutu" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Yayınlamak" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub Lisans" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« CANLI DEMO »</strong></a>
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

Puter, zengin özelliklere sahip, son derece hızlı ve son derece genişletilebilir olacak şekilde tasarlanmış gelişmiş, açık kaynaklı bir internet işletim sistemidir. Puter şu şekilde kullanılabilir:

- Tüm dosyalarınızı, uygulamalarınızı ve oyunlarınızı tek bir güvenli yerde tutmak için gizlilik öncelikli bir kişisel bulut, her yerden her zaman erişilebilir.
- Web siteleri, web uygulamaları ve oyunlar oluşturmak ve yayınlamak için bir platform.
- Yeni bir arayüz ve güçlü özelliklerle Dropbox, Google Drive, OneDrive vb. uygulamalara bir alternatif.
- Sunucular ve iş istasyonları için bir uzak masaüstü ortamı.
- Web geliştirme, bulut bilişim, dağıtık sistemler ve çok daha fazlası hakkında bilgi edinmek için dost canlısı, açık kaynaklı bir proje ve topluluk!

<br/>

## Başlarken


### 💻 Yerel Geliştirme

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Bu, Puter'ı http://puter.localhost:4100 adresinde (veya bir sonraki kullanılabilir portta) başlatacaktır.

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

Puter, [**puter.com**](https://puter.com) adresinde barındırılan bir hizmet olarak kullanılabilir.

<br/>

## Sistem Gereksinimleri

- **İşletim Sistemleri:** Linux, macOS, Windows
- **RAM:** 2GB Minimum (4GB önerilir)
- **Disk Alanı:** 1GB boş alan
- **Node.js:** Sürüm 16+ (Sürüm 22+ önerilir)
- **npm:** En son stabil sürüm

<br/>

## Destek

Bakımcılarla ve toplulukla şu kanallar aracılığıyla iletişim kurabilirsiniz:

- Hata raporu veya özellik isteği? Lütfen [yeni bir issue açın](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Güvenlik sorunları? [security@puter.com](mailto:security@puter.com)
- Bakımcılara şu adresten e-posta gönderin [hi@puter.com](mailto:hi@puter.com)

Sorularınız varsa size her zaman yardımcı olmaktan mutluluk duyarız. Sormaktan çekinmeyin!

<br/>


##  Lisans

Bu depo, tüm içeriği, alt projeleri, modülleri ve bileşenleri dahil olmak üzere, aksi açıkça belirtilmedikçe [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) altında lisanslanmıştır. Bu depoda yer alan üçüncü taraf kütüphaneler kendi lisanslarına tabi olabilir.

<br/>
