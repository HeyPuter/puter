<h3 align="center"><img width="80" alt="Puter.com, ব্যক্তিগত ক্লাউড কম্পিউটার: আপনার সমস্ত ফাইল, অ্যাপস, এবং গেম এক জায়গায়, যেকোনো সময়, যেকোনো স্থান থেকে অ্যাক্সেসযোগ্য।" src="https://assets.puter.site/puter-logo.png"></h3>

<h3 align="center">ইন্টারনেট ওএস! ফ্রি, ওপেন-সোর্স, এবং সেল্ফ-হোস্টেবল।</h3>

<p align="center">
    <img alt="GitHub রেপোর আকার " src="https://img.shields.io/github/repo-size/HeyPuter/puter"> <img alt="GitHub রিলিজ" src="https://img.shields.io/github/v/release/HeyPuter/puter?label=latest%20version"> <img alt="GitHub লাইসেন্স" src="https://img.shields.io/github/license/HeyPuter/puter">
</p>

<p align="center">
    <a href="https://puter.com/"><strong>« লাইভ ডেমো »</strong></a>
    <br />
    <br />
    <a href="https://puter.com">Puter.com</a>
    ·
    <a href="https://docs.puter.com" target="_blank">এসডিকে</a>
    ·
    <a href="https://discord.com/invite/PQcx7Teh8u">ডিসকর্ড</a>
    ·
    <a href="https://reddit.com/r/puter">রেডিট</a>
    ·
    <a href="https://twitter.com/HeyPuter">X (টুইটার)</a>
</p>

<h3 align="center"><img width="800" style="border-radius:5px;" alt="স্ক্রিনশট" src="https://assets.puter.site/puter.com-screenshot-3.webp"></h3>

<br/>

## Puter

Puter একটি উন্নত, ওপেন-সোর্স ইন্টারনেট অপারেটিং সিস্টেম যা বৈশিষ্ট্যপূর্ণ, অত্যন্ত দ্রুত এবং উচ্চ মাত্রায় সম্প্রসারণযোগ্য। Puter ব্যবহার করা যেতে পারে:

- একটি প্রাইভেসি-প্রথম পার্সোনাল ক্লাউড হিসাবে যা আপনার সমস্ত ফাইল, অ্যাপস এবং গেমসকে এক জায়গায় নিরাপদে রাখে, যেকোনো সময় যেকোনো স্থান থেকে অ্যাক্সেসযোগ্য।
- ওয়েবসাইট, ওয়েব অ্যাপ এবং গেম তৈরি ও প্রকাশ করার একটি প্ল্যাটফর্ম হিসাবে।
- ড্রপবক্স, গুগল ড্রাইভ, ওয়ানড্রাইভ ইত্যাদির বিকল্প হিসাবে একটি নতুন ইন্টারফেস এবং শক্তিশালী বৈশিষ্ট্য সহ।
- সার্ভার এবং ওয়ার্কস্টেশনের জন্য একটি রিমোট ডেস্কটপ এনভায়রনমেন্ট হিসাবে।
- ওয়েব ডেভেলপমেন্ট, ক্লাউড কম্পিউটিং, ডিস্ট্রিবিউটেড সিস্টেম এবং আরও অনেক কিছু শিখতে একটি বন্ধুত্বপূর্ণ, ওপেন-সোর্স প্রকল্প এবং কমিউনিটি হিসাবে!

<br/>

## শুরু করার জন্য

## 💻 লোকাল ডেভেলপমেন্ট

```bash
Copy code
git clone https://github.com/HeyPuter/puter
cd puter
npm install
npm start
```

এটি Puter কে http://puter.localhost:4100 (অথবা পরবর্তী উপলব্ধ পোর্টে) চালু করবে।

<br/>

## 🐳 ডকার

```bash
Copy code
mkdir puter && cd puter && mkdir -p puter/config puter/data && sudo chown -R 1000:1000 puter && docker run --rm -p 4100:4100 -v `pwd`/puter/config:/etc/puter -v `pwd`/puter/data:/var/puter  ghcr.io/heyputer/puter
```

<br/>

## 🐙 ডকার কম্পোজ

## লিনাক্স/ম্যাকওএস

```bash
Copy code
mkdir -p puter/config puter/data
sudo chown -R 1000:1000 puter
wget https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml
docker compose up
```

<br/>

## উইন্ডোজ

```powershell
Copy code
mkdir -p puter
cd puter
New-Item -Path "puter\config" -ItemType Directory -Force
New-Item -Path "puter\data" -ItemType Directory -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml" -OutFile "docker-compose.yml"
docker compose up
```

<br/>

## ☁️ Puter.com

Puter [**puter.com**](https://puter.com) এ হোস্টেড সার্ভিস হিসেবে উপলব্ধ।

<br/>

## সিস্টেম রিকোয়ারমেন্টস

- **অপারেটিং সিস্টেম:** লিনাক্স, ম্যাকওএস, উইন্ডোজ
- **র‍্যাম:** ২জিবি ন্যূনতম (৪জিবি প্রস্তাবিত)
- **ডিস্ক স্পেস:** ১জিবি ফ্রি স্পেস
- **Node.js:** সংস্করণ ১৬+ (সংস্করণ ২২+ প্রস্তাবিত)
- **npm:** সর্বশেষ স্থিতিশীল সংস্করণ

<br/>

## সাপোর্ট

মেইনটেইনার এবং কমিউনিটির সাথে এই চ্যানেলগুলির মাধ্যমে সংযোগ করুন:

- বাগ রিপোর্ট বা ফিচার রিকোয়েস্ট? অনুগ্রহ করে একটি ইস্যু খুলুন।
- ডিসকর্ড: discord.com/invite/PQcx7Teh8u
- X (টুইটার): x.com/HeyPuter
- রেডিট: reddit.com/r/puter/
- মাস্টডন: mastodon.social/@puter
- সিকিউরিটি ইস্যু? security@puter.com
- মেইনটেইনারদের ইমেইল করুন hi@puter.com এ

আপনার যেকোনো প্রশ্নের জন্য আমরা সবসময় সাহায্য করতে প্রস্তুত। জিজ্ঞাসা করতে দ্বিধা করবেন না!

<br/>

## লাইসেন্স

এই রিপোজিটরি, এর সমস্ত বিষয়বস্তু, সাব-প্রকল্প, মডিউল, এবং কম্পোনেন্ট সহ [AGPL-3.0](https://github.com/HeyPuter/puter/blob/main/LICENSE.txt) লাইসেন্সের অধীনে লাইসেন্সকৃত, যদি অন্যথায় স্পষ্টভাবে উল্লেখ না করা হয়। এই রিপোজিটরিতে অন্তর্ভুক্ত তৃতীয় পক্ষের লাইব্রেরিগুলি তাদের নিজস্ব লাইসেন্সের অধীনে হতে পারে।

<br/>
