<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">Ինտերնետ ՕՀ! Անվճար, բաց կոդով և ինքնահոսթ հնարավորությամբ։</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« Օնլայն դեմո »</strong></a>
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

Puter-ը առաջադեմ, բաց կոդով ինտերնետային օպերացիոն համակարգ է, որը նախագծված է լինել ֆունկցիոնալ հարուստ, բացառիկ արագ և բարձր ընդլայնելի։ Puter-ը կարող է օգտագործվել հետևյալ կերպ․

- Անձնական ամպային համակարգ՝ առաջնային գաղտնիությամբ, որը թույլ է տալիս պահել ձեր բոլոր ֆայլերը, հավելվածները և խաղերը մեկ անվտանգ վայրում, որը հասանելի է ցանկացած վայրից և ցանկացած ժամանակ։
- Պլատֆորմ կայքերի, վեբ հավելվածների և խաղերի ստեղծման և հրապարակման համար։
- Dropbox, Google Drive, OneDrive և այլ ծառայությունների այլընտրանք՝ նոր ինտերֆեյսով և հզոր գործառույթներով։
- Հեռավոր աշխատասեղանի միջավայր սերվերների և աշխատանքային կայանների համար։
- Պարզ, բաց կոդով նախագիծ և համայնք՝ վեբ ծրագրավորման, ամպային հաշվարկների, բաշխված համակարգերի և այլ թեմաների մասին սովորելու համար։

<br/>

## Սկսել

### 💻 Լոկալ ծրագրավորում

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

Սա կգործակի Puter-ը հետևյալ հասցեով՝ http://puter.localhost:4100 (կամ հաջորդ հասանելի պորտով)։

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

Puter-ը հասանելի է որպես հյուրընկալվող ծառայություն [**puter.com**](https://puter.com).

<br/>

## System Requirements

- **Օպերացիոն համակարգ:** Linux, macOS, Windows
- **Օպերատիվ հիշողություն:** 2GB նվազագույնը (4GB խորհուրդ է տրվում)
- **Համակարգչի հիշողություն:** 1GB ազատ տարածություն
- **Node.js:** Տարբերակ 16+ (Տարբերակ 22+ խորհուրդ է տրվում)
- **npm:** Վերջին կայուն տարբերակը

<br/>

## Աջակցություն

Կապվեք համակարգողների և համայնքի հետ այս կայքերի միջոցով՝

- Սխալների կամ գործառույթի հարցում՝ (https://github.com/HeyPuter/puter/issues/new/choose).
- Discord: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- Անվտանգության խնդիրներ՝ [security@puter.com](mailto:security@puter.com)
- Email maintainers at [hi@puter.com](mailto:hi@puter.com)

Մենք միշտ ուրախ ենք օգնել ձեզ ցանկացած հարցում։ Մի կաշկանդվեք հարցնել։

<br/>

## Լիցենզիա

Այս պահոցարանը, ներառյալ բոլոր իր բովանդակությունը, ենթա-պրոյեկտները, մոդուլները և բաղադրիչները, լիցենզավորվում են [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) լիցենզիայի տակ, եթե այլ կերպ հստակ նշված չէ։ Այս պահոցարանում ներառված երրորդ կողմի գրադարանները կարող են ենթարկվել իրենց սեփական լիցենզիաներին։

<br/>
