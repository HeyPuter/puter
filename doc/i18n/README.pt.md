<h3 align="center"><img width="80" alt="Puter.com, O Computador Pessoal em Nuvem: Todos os seus arquivos, aplicativos e jogos em um único lugar, acessíveis de qualquer lugar e a qualquer hora." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">O Sistema Operacional da Internet! Gratuito, de Código Aberto e Auto-Hospedável.</h3>

<p align="center">
    <a href="https://puter.com/"><strong>« DEMONSTRAÇÃO AO VIVO »</strong></a>
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

Puter é um sistema operacional de internet avançado e de código aberto, projetado para ser rico em recursos, excepcionalmente rápido e altamente extensível. Puter pode ser usado como:

- Um serviço de nuvem pessoal com foco na privacidade para manter todos os seus arquivos, aplicativos e jogos em um local seguro, acessível de qualquer lugar e a qualquer hora.
- Uma plataforma para construir e publicar websites, aplicativos web e jogos.
- Uma alternativa ao Dropbox, Google Drive, OneDrive, etc., com uma interface renovada e recursos poderosos.
- Um ambiente de desktop remoto para servidores e estações de trabalho.
- Um projeto e comunidade de código aberto e amigável para aprender sobre desenvolvimento web, computação em nuvem, sistemas distribuídos e muito mais!

<br/>

## Iniciando o Projeto


### 💻 Desenvolvimento Local
```
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

✨ Isso iniciará o Puter em http://puter.localhost:4100 (ou na próxima porta disponível).


Se isso não funcionar, consulte [First Run Issues](./doc/self-hosters/first-run-issues.md) para solucionar os problemas.

<br/>

### 🐳 Docker


```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```
✨ Isso iniciará o Puter em http://puter.localhost:4100 (ou na próxima porta disponível).

<br/>


### 🐙 Docker Compose


#### Linux/macOS
```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```
✨ Isso iniciará o Puter em http://puter.localhost:4100 (ou na próxima porta disponível).

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
✨ Isso iniciará o Puter em http://puter.localhost:4100 (ou na próxima porta disponível).

<br/>

### 🚀 Auto-Hospedagem

Para guia detalhados sobre como auto-hospedar o Puter, incluindo opções de configuração e melhores práticas, consulte nossa [Documentação de Auto-Hospedagem](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md).

### ☁️ Puter.com

O Puter está disponível como um serviço hospedado em [**puter.com**](https://puter.com).

<br/>

## Requerimentos do sistema

- **Sistema operacional:** Linux, macOS, Windows
- **RAM:** 2GB mínimo (4GB recomendado)
- **Espaço de disco:** 1GB de espaço disponível
- **Node.js:** Versão 16+ (Versão 23+ recomendada)
- **npm:** Última versão estável

<br/>

## Suporte

Conecte-se com os mantenedores e a comunidade através destes canais:

- Relato de bug ou solicitação de recurso? Por favor, [abra um tópico](https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Problemas de segurança? [security@puter.com](mailto:security@puter.com)
- Envie um email para os mantenedores em [hi@puter.com](mailto:hi@puter.com)

Estamos sempre felizes em ajudá-lo com quaisquer perguntas que você possa ter. Não hesite em perguntar!

<br/>


##  Licença

Este repositório, incluindo todos os seus conteúdos, subprojetos, módulos e componentes, está licenciado sob [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) a menos que explicitamente indicado de outra forma. Bibliotecas de terceiros incluídas neste repositório podem estar sujeitas às suas próprias licenças.

<br/>

## Traduções

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