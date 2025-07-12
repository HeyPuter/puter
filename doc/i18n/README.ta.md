<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: உங்கள் கோப்புகள், ஆப்ஸ் மற்றும் கேம்கள் அனைத்தும் ஒரே இடத்தில் எங்கிருந்தும் எந்த நேரத்திலும் அணுகலாம்." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">இன்டர்நெட் OS! இலவசம், ஓப்பன் சோர்ஸ் மற்றும் Self-Hostable</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub உரிமம்" src="https://img.shields.io/github/license/HeyPuter/puter" >
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« லைவ் டெமோ »</strong></a>
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

## புட்டர் (Putter)

புட்டர்(putter) என்பது ஒரு மேம்பட்ட, திறந்த மூல இலவசமாக இணைய இயக்க முறைமையாகும், இது அம்சம் நிறைந்ததாகவும், விதிவிலக்காக வேகமாகவும், அதிக விரிவாக்கக்கூடியதாகவும் வடிவமைக்கப்பட்டுள்ளது. புட்டரை இவ்வாறு பயன்படுத்தலாம்:

- உங்கள் கோப்புகள், பயன்பாடுகள் மற்றும் கேம்கள் அனைத்தையும் ஒரே பாதுகாப்பான இடத்தில் வைத்திருக்க, எந்த நேரத்திலும் எங்கிருந்தும் அணுகக்கூடிய தனியுரிமை-முதல் தனிப்பட்ட கிளவுட்.
- இணையதளங்கள், இணைய பயன்பாடுகள் மற்றும் கேம்களை உருவாக்கி வெளியிடுவதற்கான தளம் இதுவாகும்.
- புதிய இடைமுகம் மற்றும் சக்திவாய்ந்த அம்சங்களுடன் Dropbox, Google Drive, OneDrive போன்றவற்றுக்கு மாற்றீடாக உபயோகிக்க கூடியது.
- சர்வர்கள் மற்றும் பணிநிலையங்களுக்கான தொலைநிலை டெஸ்க்டாப்(desktop) சூழல்.
- வலை மேம்பாடு, கிளவுட் கம்ப்யூட்டிங், விநியோகிக்கப்பட்ட அமைப்புகள் மற்றும் பலவற்றைப் பற்றி அறிந்து ஒரு நட்பு ரீதியான, திறந்த மூல திட்டம் மற்றும் சமூக அறிவியலில் சார்ந்த ஒன்று.

<br/>

## தொடங்குதல்

### 💻 உள்ளூர் வளர்ச்சி

````bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
``` தொடக்கம்
````

இது புட்டரை <http://puter.localhost:4100> இல் தொடங்கும் (அல்லது அடுத்து கிடைக்கும் இடம்).

<br/>

### 🐳 Docker

```bash
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

### 🐙 டோக்கர் கம்போஸ்

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

புட்டர் ஹோஸ்ட் செய்யப்பட்ட சேவையாக [**puter.com**](https://puter.com) இல் கிடைக்கிறது.

<br/>

## கணினி தேவைகள்

- **இயக்க முறைமைகள்:** Linux, macOS, Windows
- **ரேம்:** குறைந்தபட்சம் 2 ஜிபி (4 ஜிபி பரிந்துரைக்கப்படுகிறது)
- **வட்டு இடம்:** 1GB இலவச இடம்
- **Node.js:** Version 16+ (Version 22+ recommended)
- **npm:** சமீபத்திய நிலையான பதிப்பு(Latest stable version)

<br/>

## ஆதரவு

இந்த சேனல்கள் மூலம் பராமரிப்பாளர்கள் மற்றும் சமூகத்துடன் சமூக இணைப்பாளர்:

- பிழை அறிக்கை அல்லது மாற்றுதல் கோரிக்கை? தயவுசெய்து [சிக்கலைத் திறக்கவும்](https://github.com/HeyPuter/puter/issues/new/choose).
- கருத்து வேறுபாடு: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Reddit: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- Mastodon: [mastodon.social/@puter](https://mastodon.social/@puter)
- பாதுகாப்பு பிரச்சினைகள்? [security@puter.com](mailto:security@puter.com)
- மின்னஞ்சல் பராமரிப்பாளர்களுக்கு [hi@puter.com](mailto:hi@puter.com)

உங்களுக்கு ஏதேனும் கேள்விகள் இருந்தால் உங்களுக்கு உதவ நாங்கள் எப்போதும் மகிழ்ச்சியடைகிறோம். தயங்காமல் கேளுங்கள்!

<br/>

## உரிமம்

இந்தக் களஞ்சியமானது, அதன் அனைத்து உள்ளடக்கங்கள், துணைத் திட்டங்கள், தொகுதிகள் மற்றும் கூறுகள் உட்பட, வெளிப்படையாகக் கூறப்படாவிட்டால், [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) இன் கீழ் உரிமம் பெற்றுள்ளது. . இந்தக் களஞ்சியத்தில் சேர்க்கப்பட்டுள்ள மூன்றாம் தரப்பு நூலகங்கள் அவற்றின் சொந்த உரிமங்களுக்கு உட்பட்டதாக இருக்கும்.

<br/>
