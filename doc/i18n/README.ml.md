<h3 align="center"><img width="80" alt="Puter.com, പേഴ്സണൽ ക്ലൗഡ് കമ്പ്യൂട്ടർ: നിങ്ങളുടെ എല്ലാ ഫയലുകളും ആപ്പുകളും ഗെയിമുകളും ഒരിടത്ത്, എപ്പോൾ വേണമെങ്കിലും എവിടെ നിന്നും ലഭ്യം." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">ഓപ്പൺ സോഴ്സ് ഇന്റർനെറ്റ് കമ്പ്യൂട്ടർ!</h3>

<p align="center">
    <a href="https://puter.com/"><strong>« ലൈവ് ഡെമോ »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/">Puter.com</a>
    ·
    <a href="https://office.puter.com/">Office Suite</a>
    ·
    <a href="https://builder.puter.com/">AI Builder</a>
    ·
    <a href="https://developer.puter.com" target="_blank">ഡെവലപ്പർമാർ</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="സ്ക്രീൻഷോട്ട്" src="https://assets.puter.com/puter.webp"></h3>

<br/>

## Puter

ഫീച്ചറുകളാൽ സമ്പന്നവും വേഗതയേറിയതും ഏറെ വിപുലീകരിക്കാവുന്നതുമായി രൂപകൽപ്പന ചെയ്ത, സ്വയം ഹോസ്റ്റ് ചെയ്യാവുന്ന നൂതന ഓപ്പൺ സോഴ്സ് ഇന്റർനെറ്റ് കമ്പ്യൂട്ടറാണ് Puter.

### ഉപയോക്താക്കൾക്ക്
ജോലി ചെയ്യാനും സൃഷ്ടിക്കാനും കളിക്കാനും ആവശ്യമായതെല്ലാം ഒരു കുടക്കീഴിൽ നൽകുക എന്നതാണ് Puter-ന്റെ ലക്ഷ്യം. ലളിതമായ [Notepad](https://online-notepad.com), [Camera](https://online-camera.com) മുതൽ [Office Suite](https://office.puter.com), [AI Builder](https://builder.puter.com) വരെ, നിങ്ങളുടെ ഡിജിറ്റൽ ജീവിതത്തിനുള്ള ഓൾ-ഇൻ-വൺ പരിഹാരമാകാൻ Puter ആഗ്രഹിക്കുന്നു.


### ഡെവലപ്പർമാർക്ക്

വെബ് ആപ്പുകളും ഗെയിമുകളും നിർമ്മിക്കാനും പ്രസിദ്ധീകരിക്കാനും ആവശ്യമായതെല്ലാം Puter നൽകുന്നു. [AI](https://developer.puter.com/ai/), [ക്ലൗഡ് സ്റ്റോറേജ്](https://developer.puter.com/object-storage/), [ഡാറ്റാബേസ്](https://developer.puter.com/key-value-database/), [സെർവർലെസ് വർക്കേഴ്സ്](https://developer.puter.com/serverless-workers/) എന്നിവ വരെ എല്ലാം Puter-ൽ ലഭ്യമാണ്. ഉപയോക്താക്കളെ നേടാനും Puter സഹായിക്കും! നിങ്ങളുടെ ആപ്പ് നിർമ്മിച്ച ശേഷം, ഞങ്ങളുടെ [App Store](https://apps.puter.com/)-ൽ പ്രസിദ്ധീകരിച്ച് ഉപയോക്താക്കളിലേക്ക് എത്താനും വരുമാനം നേടാനും കഴിയും.

<br/>

## തുടങ്ങാം


### 💻 ലോക്കൽ ഡെവലപ്മെന്റ്

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** ഇത് http://puter.localhost:4100 -ൽ Puter ലോഞ്ച് ചെയ്യും

ഈ ചെക്ക്ഔട്ട് Docker ഉപയോഗിച്ച് പ്രവർത്തിപ്പിക്കാൻ, [സോഴ്സിൽ നിന്ന് ബിൽഡ് ചെയ്യൽ](../self-hosting.md#building-from-source-instead-of-pulling) പിന്തുടരുക. ലോക്കൽ ബിൽഡ് തിരഞ്ഞെടുക്കാൻ ഒരു ലോക്കൽ `docker-compose.override.yml` ഉണ്ടാക്കുക. ഈ ക്രമീകരണങ്ങൾ `docker-compose.yml`-ന് പുറത്ത് സൂക്ഷിക്കുന്നത് അപ്ഡേറ്റുകൾ പുൾ ചെയ്യുമ്പോഴുള്ള കോൺഫ്ലിക്റ്റുകൾ ഒഴിവാക്കുകയും ലോക്കൽ കോൺഫിഗറേഷൻ പുൾ റിക്വസ്റ്റുകളിൽ കടക്കാതിരിക്കുകയും ചെയ്യും.


<br/>

### 🚀 സെൽഫ്-ഹോസ്റ്റിംഗ്

#### Linux/macOS

```bash
curl -fsSL https://puter.com/selfhost | sh
```

#### Windows

```powershell
irm https://puter.com/selfhost?os=windows | iex
```

**→** കൂടുതൽ വിവരങ്ങൾക്ക് [Puter സെൽഫ്-ഹോസ്റ്റ് ചെയ്യൽ](../self-hosting.md) കാണുക.

<br/>

### ☁️ Puter.com

Puter ഒരു ഹോസ്റ്റഡ് സേവനമായി [**puter.com**](https://puter.com)-ൽ ലഭ്യമാണ്.

<br/>

## പിന്തുണ

ഈ ചാനലുകൾ വഴി മെയിന്റനർമാരുമായും കമ്മ്യൂണിറ്റിയുമായും ബന്ധപ്പെടാം:

- ബഗ് റിപ്പോർട്ടോ ഫീച്ചർ അഭ്യർത്ഥനയോ ഉണ്ടോ? [ഒരു ഇഷ്യൂ തുറക്കുക](https://github.com/HeyPuter/puter/issues/new/choose).
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- സുരക്ഷാ പ്രശ്നങ്ങളോ ദുരുപയോഗ റിപ്പോർട്ടുകളോ? [security@puter.com](mailto:security@puter.com)
- മെയിന്റനർമാർക്ക് [hi@puter.com](mailto:hi@puter.com) ലേക്ക് ഇമെയിൽ ചെയ്യുക

നിങ്ങളുടെ ഏത് സംശയങ്ങളിലും സഹായിക്കാൻ ഞങ്ങൾക്ക് എപ്പോഴും സന്തോഷമേയുള്ളൂ. ചോദിക്കാൻ മടിക്കരുത്!

<br/>

## ലൈസൻസ്

ഈ റിപ്പോസിറ്ററി, അതിലെ എല്ലാ ഉള്ളടക്കങ്ങളും, ഉപ-പ്രോജക്റ്റുകളും, മോഡ്യൂളുകളും, ഘടകങ്ങളും ഉൾപ്പെടെ, വ്യക്തമായി മറ്റൊന്ന് പറഞ്ഞിട്ടില്ലെങ്കിൽ [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) ലൈസൻസിന് കീഴിലാണ്. ഈ റിപ്പോസിറ്ററിയിൽ ഉൾപ്പെടുത്തിയിട്ടുള്ള മൂന്നാം കക്ഷി ലൈബ്രറികൾക്ക് അവരുടേതായ ലൈസൻസുകൾ ബാധകമായേക്കാം.

<br/>

## വിവർത്തനങ്ങൾ

- [Arabic / العربية](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ar.md)
- [Armenian / Հայերեն](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hy.md)
- [Bengali / বাংলা](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.bn.md)
- [Chinese / 中文](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.zh.md)
- [Danish / Dansk](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.da.md)
- [English](https://github.com/HeyPuter/puter/blob/main/README.md)
- [Farsi / فارسی](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fa.md)
- [Finnish / Suomi](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fi.md)
- [French / Français](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.fr.md)
- [German /  Deutsch](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.de.md)
- [Hebrew/ עברית](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.he.md)
- [Hindi / हिंदी](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hi.md)
- [Hungarian / Magyar](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.hu.md)
- [Indonesian / Bahasa Indonesia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.id.md)
- [Italian / Italiano](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.it.md)
- [Japanese / 日本語](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.jp.md)
- [Korean / 한국어](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ko.md)
- [Malay / Bahasa Malaysia](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.my.md)
- [Malayalam / മലയാളം](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.ml.md)
- [Dutch / Nederlands](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.nl.md)
- [Polish / Polski](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pl.md)
- [Odia / ଓଡ଼ିଆ](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.od.md)
- [Portuguese / Português](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pt.md)
- [Punjabi / ਪੰਜਾਬੀ](https://github.com/HeyPuter/puter/blob/main/doc/i18n/README.pa.md)
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
