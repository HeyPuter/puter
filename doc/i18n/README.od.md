<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">ଇଣ୍ଟରନେଟ OS! ନିଶୁଳ୍କ, ଖୋଲା-ମୂଳ (Open-Source), ଏବଂ ସ୍ୱୟଂ-ହୋଷ୍ଟ କରିପାରିବା।</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« LIVE ଡେମୋ »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
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
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="screenshot" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter ହେଉଛି ଗୋଟିଏ ଉନ୍ନତ, ଖୋଲା-ମୂଳ ଇଣ୍ଟରନେଟ ଅପରେଟିଂ ସିଷ୍ଟମ, ଯାହାକି ବିଶେଷତାସମୃଦ୍ଧ, ଶୀଘ୍ର ଏବଂ ଏକ୍ସଟେନ୍ସିବଲ ଭାବେ ଡିଜାଇନ୍ କରାଯାଇଛି। Puter କୁ ନିମ୍ନ ପ୍ରକାରେ ବ୍ୟବହାର କରିପାରିବେ:

- ଗୋଟିଏ ପ୍ରାଇଭେସି-ପ୍ରଥମ (privacy-first) ପର୍ସନାଲ କ୍ଲାଉଡ୍ ଭାବେ — ଯେଉଁଠାରେ ଆପଣଙ୍କ ସମସ୍ତ ଫାଇଲ୍, ଆପ୍ସ ଏବଂ ଗେମ୍ସ ଗୋଟିଏ ସୁରକ୍ଷିତ ସ୍ଥାନରେ ରହିବ, ଯାହାକୁ କେଉଁଠୁ ସମୟରେ ଆକ୍ସେସ୍ କରିପାରିବେ।
- ୱେବସାଇଟ୍, ୱେବ ଆପ୍ସ, ଏବଂ ଗେମ୍ ତିଆରି ଏବଂ ପ୍ରକାଶ ପାଇଁ ଗୋଟିଏ ପ୍ଲାଟଫର୍ମ।
- Dropbox, Google Drive, OneDrive ଇତ୍ୟାଦିଙ୍କ ବିକଳ୍ପ ଭାବେ — ଏକ ସୁନ୍ଦର ଇଣ୍ଟରଫେସ୍ ଏବଂ ଶକ୍ତିଶାଳୀ ବୈଶିଷ୍ଟ ସହିତ।
- ସର୍ଭର ଏବଂ ଓର୍କସ୍ଟେସନ୍ ପାଇଁ ଗୋଟିଏ ରିମୋଟ୍ ଡେସ୍କଟପ୍ ଇନ୍ଭାୟରମେଣ୍ଟ।
- ୱେବ୍ ଡିଭେଲପମେଣ୍ଟ, କ୍ଲାଉଡ୍ କମ୍ପ୍ୟୁଟିଙ୍ଗ, ବିତରିତ ସିଷ୍ଟମ (distributed systems) ଇତ୍ୟାଦି ଶିଖିବା ପାଇଁ ଗୋଟିଏ ସହଜ-ମନୋଭାବୀ ଖୋଲା-ମୂଳ ସମୁଦାୟ।

<br/>

## ପ୍ରାରମ୍ଭ (Getting Started)

### 💻 Local Development

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** ଏହା Puter କୁ ଲଞ୍ଚ କରିବ:  
<font color="red"> http://puter.localhost:4100 (ଅଥବା ଅନ୍ୟ ଉପଲବ୍ଧ ପୋର୍ଟ୍) </font>

ଯଦି ଏହା କାମ କରୁନାହିଁ, ତେବେ [First Run Issues](./doc/self-hosters/first-run-issues.md) କୁ ଦେଖନ୍ତୁ।

<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```
**→** ଏହା Puter କୁ ଲଞ୍ଚ କରିବ:  
<font color="red"> http://puter.localhost:4100 (ଅଥବା ଅନ୍ୟ ଉପଲବ୍ଧ ପୋର୍ଟ୍) </font>

<br/>

### 🐙 Docker Compose

#### Linux/macOS

```bash
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```
**→** ଏହା ଉପଲବ୍ଧ ହେବ:  
<font color="red"> http://puter.localhost:4100 (ଅଥବା ଅନ୍ୟ ଉପଲବ୍ଧ ପୋର୍ଟ୍) </font>

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
**→** ଏହା Puter କୁ ଲଞ୍ଚ କରିବ:  
<font color="red"> http://puter.localhost:4100 (ଅଥବା ଅନ୍ୟ ଉପଲବ୍ଧ ପୋର୍ଟ୍) </font>

<br/>

### 🚀 Self-Hosting

Self-Hosting ପାଇଁ ବିସ୍ତୃତ ଗାଇଡ୍, କନଫିଗୁରେସନ୍ ଅପ୍ସନ୍ ଏବଂ ବେଷ୍ଟ-ପ୍ରାକ୍ଟିସ୍ ପାଇଁ ଏଠାରେ ଯାଆନ୍ତୁ:  
[Self-Hosting Documentation](https://github.com/HeyPuter/puter/blob/main/doc/self-hosters/instructions.md)

<br/>

### ☁️ Puter.com

Puter ହୋଷ୍ଟେଡ୍ ସର୍ଭିସ୍ ଭାବେ ଉପଲବ୍ଧ ଅଛି: [**puter.com**](https://puter.com)

<br/>

## ସିଷ୍ଟମ ଆବଶ୍ୟକତା (System Requirements)

- **Operating Systems:** Linux, macOS, Windows  
- **RAM:** ଅନ୍ୟୁନ 2GB (ପରାମର୍ଶ 4GB)  
- **Disk Space:** 1GB ଖାଲି ସ୍ଥାନ  
- **Node.js:** ସଂସ୍କରଣ 20.19.5+ (ପରାମର୍ଶ 23+)  
- **npm:** ନବୀନତମ ସ୍ଥିର ସଂସ୍କରଣ  

<br/>

## ସହଯୋଗ (Support)

ମେଣ୍ଟେନର୍ ଏବଂ ସମୁଦାୟ ସହିତ ଯୋଡ଼ିବା ପାଇଁ:

- Bug report କିମ୍ବା ନୂଆ feature ବାବଦରେ? [open an issue](https://github.com/HeyPuter/puter/issues/new/choose)
- Discord: https://discord.com/invite/PQcx7Teh8u
- X (Twitter): https://x.com/HeyPuter
- Reddit: https://www.reddit.com/r/puter/
- Mastodon: https://mastodon.social/@puter
- Security issues? [security@puter.com](mailto:security@puter.com)
- Maintain­er Email: [hi@puter.com](mailto:hi@puter.com)

ଆମେ ସମସ୍ତେ ସହାୟତା ପାଇଁ ସଦା ପ୍ରସ୍ତୁତ।

<br/>

## ଲାଇସେନ୍ସ (License)

ଏହି ରିପୋଜିଟୋରୀ, ସମସ୍ତ ସବ୍-ପ୍ରୋଜେକ୍ଟ, ମୋଡ୍ୟୁଲ୍ ଏବଂ କମ୍ପୋନେଣ୍ଟ ସହିତ **AGPL-3.0** ଲାଇସେନ୍ସ ଅଧୀନରେ ରହିଛି।  
ତୃତୀୟ ପକ୍ଷ ଲାଇବ୍ରେରି ନିଜସ୍ୱ ଲାଇସେନ୍ସ ଅଧୀନରେ ଥାଇପାରେ।

<br/>

## ଅନ୍ୟ README ଲିଙ୍କ୍ (Links to Other READMEs)

### Backend
- [PuterAI Module](./src/backend/doc/modules/puterai/README.md)
- [Metering Service](./src/backend/src/services/MeteringService/README.md)
- [Extensions Development Guide](./extensions/README.md)
