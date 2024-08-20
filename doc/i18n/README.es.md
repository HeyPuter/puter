<h3 align="center"><img width="80" alt="Puter.com, El Computador Personal en Nube: Todos tus archivos, apps y juegos en un solo lugar accesible desde cualquier lugar en cualquier momento" src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">El Sistema Operativo de Internet! Gratis, de Código abierto, y Autohospedable.</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
<a href="https://github.com/HeyPuter/puter/blob/main/README.md"><img alt="English" src="https://img.shields.io/badge/English-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.da.md"><img alt="Danish (Dansk)" src="https://img.shields.io/badge/Danish%20(Dansk)-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md"><img alt="Hindi (हिंदी)" src="https://img.shields.io/badge/Hindi%20(हिंदी)-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md"><img alt="Japanese (日本語)" src="https://img.shields.io/badge/Japanese%20(日本語)-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md"><img alt="Portuguese (Português)" src="https://img.shields.io/badge/Portuguese%20(Português)-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ru.md"><img alt="Russian (Русский)" src="https://img.shields.io/badge/Russian%20(Русский)-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.es.md"><img alt="Spanish (Español)" src="https://img.shields.io/badge/Spanish%20(Español)-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.tr.md"><img alt="Turkish (Türkçe)" src="https://img.shields.io/badge/Turkish%20(Türkçe)-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.vi.md"><img alt="Vietnamese (Tiếng Việt)" src="https://img.shields.io/badge/Vietnamese%20(Tiếng%20Việt)-lightgrey"></a>
<a href="https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.zh.md"><img alt="Chinese (中文)" src="https://img.shields.io/badge/Chinese%20(中文)-lightgrey"></a>
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« DEMO EN VIVO »</strong></a>
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
    <a href="https://hackerone.com/puter_h1b">Recompensa por bugs</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter es un sistema operativo en internet avanzado y de código abierto, diseñado para ser rico en funcionalidades, excepcionalmente rápido y altamente extensible. Puter puede ser usado como:

- Una nube personal privada para almacenar todos tus archivos, aplicaciones y juegos en un lugar seguro, accesible y desde cualquier lugar en cualquier momento.
- Una plataforma para construir y publicar páginas web, aplicativos sobre la web y juegos.
- Una alternativa a Dropbox, Google Drive, OneDrive, etc. con una interfaz fresca y llena de funcionalidades.
- Un entorno de escritorio remoto para servidores y estaciones de trabajo.
- Un proyecto y comunidad abiertas y amigables para aprender sobre desarrollo web, computación en la nube, sistemas distribuidos y mucho más!

<br/>

## Primeros Pasos


### 💻 Desarrollo Local

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Esto ejecutará Puter en http://puter.localhost:4100 (o el siguiente puerto disponible).

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

Puter está disponible como servicio alojado en [**puter.com**](https://puter.com).

<br/>

## Requerimientos del sistema

- **Sistemas operativos:** Linux, macOS, Windows
- **RAM:** 2GB mínimo (4GB recomendados)
- **Almacenamiento:** 1GB de espacio libre
- **Node.js:** Versión 16+ (Versión 22+ recomendada)
- **npm:** Última version estable

<br/>

## Soporte

Conéctate con los mantenedores y la comunidad a través de estos canales:

- Reporte de bug o solicitud de funcionalidad? Por favor [abrir un issue](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Problemas de seguridad? [security@puter.com](mailto:security@puter.com)
- Envia un email a los mantenedores en [hi@puter.com](mailto:hi@puter.com)

Estamos siempre felices de ayudar con cualquier pregunta que puedas tener. No dudes en preguntar!

<br/>


##  Licencia

Este repositorio, incluyendo todo su contenido, sub-proyectos, modulos y componentes, esta licenciado bajo [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) a menos que se indique explícitamente lo contrario. Librerías de terceros incluidos en este repositorio pueden estar sujetas a sus propias licencias.

<br/>
