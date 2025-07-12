<h3 align="center"><img width="80" alt="Puter.com, The Personal Cloud Computer: All your files, apps, and games in one place accessible from anywhere at any time." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">ഇന്റർനെറ്റ് ഓപ്പറേറ്റിംഗ് സിസ്റ്റം!<br> സൗജന്യവും, ഓപ്പൺ സോഴ്സും സ്വയം ഹോസ്റ്റ് ചെയ്യാൻ പറ്റുന്നതും</h3>

<p align="center">
    <img alt="GitHub repo size" src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub Release" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub License" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>
<p align="center">
    <a href="https://puter.com/"><strong>« ലൈവ് ഡെമോ »</strong></a>
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

## പ്യൂട്ടർ (Puter)

ഫീച്ചറുകളാൽ സമ്പുഷ്ടവും അസാധാരണമാംവിധം വേഗതയേറിയതും,വളരെ വിപുലീകരിക്കാവുന്നതുമായ ഒരു നൂതന, ഓപ്പൺ സോഴ്‌സ് ഇന്റർനെറ്റ് ഓപ്പറേറ്റിംഗ് സിസ്റ്റമാണ് പ്യൂട്ടർ. പ്യൂട്ടർ ഇനിപ്പറയുന്ന രീതിയിൽ ഉപയോഗിക്കാം:

- നിങ്ങളുടെ എല്ലാ ഫയലുകളും ആപ്പുകളും ഗെയിമുകളും ഒരു സുരക്ഷിത സ്ഥലത്ത് സൂക്ഷിക്കുന്നതിനുള്ള, സ്വകാര്യതയ്ക്ക് മുൻഗണന കൊടുക്കുന്ന ആദ്യത്തെ വ്യക്തിഗത ക്ലൗഡ്, എവിടെ നിന്നും എപ്പോൾ വേണമെങ്കിലും ആക്‌സസ് ചെയ്യാൻ കഴിയും.
- വെബ്‌സൈറ്റുകൾ, വെബ് ആപ്പുകൾ, ഗെയിമുകൾ എന്നിവ നിർമ്മിക്കുന്നതിനും പ്രസിദ്ധീകരിക്കുന്നതിനുമുള്ള ഒരു പ്ലാറ്റ്ഫോം.
- പുതിയ ഇന്റർഫേസും, ശക്തമായ ഫീച്ചറുകളും അടങ്ങിയ, ഡ്രോപ്പ്‌ബോക്‌സ്, ഗൂഗിൾ ഡ്രൈവ്, വൺഡ്രൈവ് മുതലായവയ്‌ക്കുള്ള ബദൽ.
- സെർവറുകൾക്കും വർക്ക്സ്റ്റേഷനുകൾക്കും, ഒരു വിദൂര ഡെസ്ക്ടോപ്പ് പരിസ്ഥിതി.
- വെബ് ഡെവലപ്മെന്റ്, ക്ലൗഡ് കംപ്യൂട്ടിംഗ്, ഡിസ്ട്രിബ്യൂട്ടഡ് സിസ്റ്റങ്ങൾ എന്നിവയെ കുറിച്ചും, അതിലേറെ കാര്യങ്ങളെ കുറിച്ചും അറിയാനുള്ള സൗഹൃദപരവും ഓപ്പൺ സോഴ്സുമായ പ്രോജക്റ്റും കമ്മ്യൂണിറ്റിയും!

<br/>

## തുടങ്ങാനായി

### 💻 ലോക്കൽ ഡെവലപ്മെന്റ്

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

ഇത് http://puter.localhost:4100 (അല്ലെങ്കിൽ അടുത്ത ലഭ്യമായ പോർട്ടിൽ) എന്നതിൽ Puter സമാരംഭിക്കും

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

പ്യൂട്ടർ [**puter.com**](https://puter.com) എന്നതിൽ ഹോസ്റ്റ് ചെയ്‌ത സേവനമായി ലഭ്യമാണ്.

<br/>

## സിസ്റ്റത്തിന്റെ ആവശ്യകതകൾ

- **ഓപ്പറേറ്റിംഗ് സിസ്റ്റങ്ങൾ:** ലിനക്സ്, മാക്ക് ഒഎസ്, വിൻഡോസ്
- **RAM:** 2GB കുറഞ്ഞത് (4GB ശുപാർശ ചെയ്യുന്നു)
- **ഡിസ്ക് സ്പേസ്:** 1GB ഒഴിഞ്ഞ ഇടം
- **Node.js:** Version 16+ (Version 22+ ശുപാർശ ചെയ്യുന്നു)
- **npm:** ഏറ്റവും പുതിയ സ്ഥിരതയുള്ള പതിപ്പ്

<br/>

## പിന്തുണ

ഈ ചാനലുകളിലൂടെ പരിപാലിക്കുന്നവരുമായും കമ്മ്യൂണിറ്റിയുമായും ബന്ധപ്പെടുക:

- ബഗ്ഗ് റിപ്പോർട്ടോ, ഫീച്ചർ റിക്ക്വസ്റ്റോ ഉണ്ടോ? ദയവുചെയ്ത് [ഒരു ഇഷ്യൂ തുടങ്ങുക](https://github.com/HeyPuter/puter/issues/new/choose).
- ഡിസ്കോർഡ്: [discord.com/invite/PQcx7Teh8u](https://discord.com/invite/PQcx7Teh8u)
- എക്സ് (ട്വിറ്റർ): [x.com/HeyPuter](https://x.com/HeyPuter)
- റെഡ്ഡിറ്റ്: [reddit.com/r/puter/](https://www.reddit.com/r/puter/)
- മാസ്റ്റഡൺ: [mastodon.social/@puter](https://mastodon.social/@puter)
- സുരക്ഷാ പ്രശ്നങ്ങളുണ്ടോ? [security@puter.com](mailto:security@puter.com)
- ഇമെയിൽ മെയിന്റൈനർമാർ: [hi@puter.com](mailto:hi@puter.com)

നിങ്ങൾക്ക് ഉണ്ടായേക്കാവുന്ന ഏത് ചോദ്യങ്ങളിലും നിങ്ങളെ സഹായിക്കുന്നതിൽ ഞങ്ങൾക്ക് എപ്പോഴും സന്തോഷമുണ്ട്. ചോദിക്കാൻ മടിക്കേണ്ട!

<br/>

## ലൈസൻസ്

ഈ ശേഖരം, അതിന്റെ എല്ലാ ഉള്ളടക്കങ്ങളും, ഉപപദ്ധതികളും, മൊഡ്യൂളുകളും, ഘടകങ്ങളും ഉൾപ്പെടെ, [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) എന്നതിന് കീഴിൽ ലൈസൻസുള്ളതാണ്. ഈ ശേഖരത്തിൽ ഉൾപ്പെടുത്തിയിരിക്കുന്ന മൂന്നാം കക്ഷി ലൈബ്രറികൾ അവരുടെ സ്വന്തം ലൈസൻസുകൾക്ക് വിധേയമായിരിക്കാം.

<br/>
