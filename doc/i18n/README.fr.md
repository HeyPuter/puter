<h3 align="center"><img width="80" alt="Puter.com, l'ordinateur cloud personnel : tous vos fichiers, applications et jeux en un seul endroit, accessibles de partout à tout moment." src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">L'ordinateur Internet open source !</h3>

<p align="center">
    <a href="https://puter.com/?ref=github.com"><strong>« DÉMO EN DIRECT »</strong></a>
    <br />
    <br />
    <a href="https://puter.com/?ref=github.com">Puter.com</a>
    ·
    <a href="https://office.puter.com/">Office Suite</a>
    ·
    <a href="https://builder.puter.com/">AI Builder</a>
    ·
    <a href="https://developer.puter.com" target="_blank">Développeurs</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="capture d'écran" src="https://assets.puter.com/puter-screenshot.webp"></h3>

<br/>

## Puter

Puter est un ordinateur internet avancé, open source et auto-hébergeable, conçu pour être riche en fonctionnalités, rapide et hautement extensible.

### Pour les utilisateurs
L'objectif de Puter est de vous offrir tout ce dont vous avez besoin pour travailler, créer et jouer au même endroit. D'un simple [Notepad](https://online-notepad.com) et [Camera](https://online-camera.com) jusqu'à [Office Suite](https://office.puter.com) et [AI Builder](https://builder.puter.com), Puter veut être la solution tout-en-un de votre vie numérique.


### Pour les développeurs

Puter vous fournit tout ce qu'il faut pour créer et publier des applications web et des jeux. De l'[IA](https://developer.puter.com/ai/) au [stockage cloud](https://developer.puter.com/object-storage/) et à la [base de données](https://developer.puter.com/key-value-database/), en passant par les [workers serverless](https://developer.puter.com/serverless-workers/), Puter vous couvre. Puter vous aide aussi à trouver des utilisateurs ! Une fois votre application créée, vous pouvez la publier sur notre [App Store](https://apps.puter.com/) pour toucher des utilisateurs et la monétiser.

<br/>

## Démarrage


### 💻 Développement local

```bash
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```
**→** Cela devrait lancer Puter à l'adresse  http://puter.localhost:4100

Pour exécuter ce dépôt avec Docker, suivez [Compilation depuis les sources](../self-hosting.md#building-from-source-instead-of-pulling). Créez un fichier `docker-compose.override.yml` local pour sélectionner la compilation locale ; en gardant ces paramètres en dehors de `docker-compose.yml`, vous évitez les conflits lors de la récupération des mises à jour et vous gardez la configuration locale hors des pull requests.

<br/>

### 🚀 Auto-hébergement

#### Linux/macOS

```bash
curl -fsSL https://puter.com/selfhost | sh
```

#### Windows

```powershell
irm https://puter.com/selfhost?os=windows | iex
```

**→** Pour plus de détails, consultez [Auto-hébergement de Puter](../self-hosting.md).

<br/>

### ☁️ Puter.com

Puter est disponible en tant que service hébergé sur [**puter.com**](https://puter.com).

<br/>

## Support

Échangez avec les mainteneurs et la communauté via ces canaux :

- Un bug ou une demande de fonctionnalité ? Veuillez [ouvrir une issue](https://github.com/HeyPuter/puter/issues/new/choose).
- X (Twitter): [x.com/HeyPuter](https://x.com/HeyPuter)
- Un problème de sécurité ou un abus à signaler ? [security@puter.com](mailto:security@puter.com)
- Écrivez aux mainteneurs à [hi@puter.com](mailto:hi@puter.com)

Nous sommes toujours heureux de répondre à vos questions. N'hésitez pas à nous solliciter !

<br/>

## Licence

Ce dépôt, y compris tout son contenu, ses sous-projets, modules et composants, est placé sous licence [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt), sauf mention contraire explicite. Les bibliothèques tierces incluses dans ce dépôt peuvent être soumises à leurs propres licences.

<br/>

## Traductions

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
