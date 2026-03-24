<h3 align="center"><img width="80" alt="Puter.com, El Computador Personal en Nube: Todos tus archivos, apps y juegos en un solo lugar accesible desde cualquier lugar en cualquier momento" src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">El Sistema Operativo de Internet! Gratis, de Código abierto, y Autohospedable.</h3>

<p align="center">
    <a href="https://puter.com/"><strong>« DEMO EN VIVO »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://apps.puter.com/">App Store</a>
    ·
    <a href="https://developer.puter.com" target="_blank">Developers</a>
    ·
    <a href="https://github.com/heyputer/puter-cli" target="_blank">CLI</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">Discord</a>
    ·
    <a href="https://reddit.com/r/puter">Reddit</a>
    ·
    <a href="https://x.com/HeyPuter">X (Twitter)</a>
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

✨ Esto ejecutará Puter en http://puter.localhost:4100 (o el siguiente puerto disponible).

Si esto no funciona, consulta [First Run Issues](./doc/self-hosters/first-run-issues.md) para obtener pasos de solución de problemas.
<br/>

### 🐳 Docker


```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```
✨ Esto ejecutará Puter en http://puter.localhost:4100 (o el siguiente puerto disponible).

<br/>


### 🐙 Docker Compose


#### Linux/macOS
```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```
✨ Esto ejecutará Puter en http://puter.localhost:4100 (o el siguiente puerto disponible).
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
✨ Esto ejecutará Puter en http://puter.localhost:4100 (o el siguiente puerto disponible).

<br/>

### 🚀 Auto-Hospedaje

Para guías detalladas sobre cómo auto-hospedar Puter, incluyendo opciones de configuración y mejores prácticas, consulta nuestra [Documentación de Auto-Hospedaje](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md).

### ☁️ Puter.com

Puter está disponible como servicio alojado en [**puter.com**](https://puter.com).

<br/>

## Requerimientos del sistema

- **Sistemas operativos:** Linux, macOS, Windows
- **RAM:** 2GB mínimo (4GB recomendados)
- **Almacenamiento:** 1GB de espacio libre
- **Node.js:** Versión 16+ (Versión 23+ recomendada)
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

## Traducciones

- [Arabic / العربية](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ar.md)
- [Armenian / Հայերեն](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hy.md)
- [Bengali / বাংলা](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.bn.md)
- [Chinese / 中文](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.zh.md)
- [Danish / Dansk](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.da.md)
- [English](https://github.com/HeyPuter/puter/blob/main/README.md)
- [Farsi / فارسی](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fa.md)
- [Finnish / Suomi](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fi.md)
- [French / Français](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fr.md)
- [German/ Deutsch](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.de.md)
- [Hebrew/ עברית](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.he.md)
- [Hindi / हिंदी](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md)
- [Hungarian / Magyar](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hu.md)
- [Indonesian / Bahasa Indonesia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.id.md)
- [Italian / Italiano](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.it.md)
- [Japanese / 日本語](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md)
- [Korean / 한국어](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ko.md)
- [Malayalam / മലയാളം](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ml.md)
- [Polish / Polski](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pl.md)
- [Portuguese / Português](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md)
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