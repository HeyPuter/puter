# Changelog

## 2.3.0 (2024-05-22)


### Features

* add /healthcheck endpoint ([c166560](https://github.com/HeyPuter/puter/commit/c166560ff4ab5a453d3ec4f97326c995deb7f522))
* Add command names to phoenix tab-completion ([cf0eee1](https://github.com/HeyPuter/puter/commit/cf0eee1fa35328e05aefc8a425b5977efe5f4ec9))
* add option to change desktop background to default ([03f05f3](https://github.com/HeyPuter/puter/commit/03f05f316f11e8afe5fcee40b2b80a0de5e6826f))
* allow apps to add a menubar via puter.js ([331d9e7](https://github.com/HeyPuter/puter/commit/331d9e75428ec7609394f59b1755374c7340f83e))
* Allow querying puter-apps driver by partial app names ([dc5b010](https://github.com/HeyPuter/puter/commit/dc5b010d0913d2151b4851f8da5df72d2c8f42e7))
* Display upload errors in UIWindowProgress dialog ([edebbee](https://github.com/HeyPuter/puter/commit/edebbee9e7e9efbb33bf709b637c103be40d15a8))
* Implement 'Like' predicate in entity storage ([a854a0d](https://github.com/HeyPuter/puter/commit/a854a0dc0aa79a31695db833184c5ca3698632a9))
* improve password recovery experience ([04432df](https://github.com/HeyPuter/puter/commit/04432df5540811710ce1cc47ce6c136e5453bccb))
* **security:** add ip rate limiting ([ccf1afc](https://github.com/HeyPuter/puter/commit/ccf1afc93c24ee7f9a126216209a185d6b4d9fe4))
* Show "Deleting /foo" in progress window when deleting files ([f07c13a](https://github.com/HeyPuter/puter/commit/f07c13a50cee790eec44bce2f6e56fbcbf73f9b0))


### Bug Fixes

* Add missing file extension to 0009_app-prefix-fix.sql in DB init ([a8160a8](https://github.com/HeyPuter/puter/commit/a8160a8cdcdd6aff98728a6f1643d93386e6bb5a))
* Add missing TextEncoder to PTT ([8d4a1e0](https://github.com/HeyPuter/puter/commit/8d4a1e0ed3872e2c82b9e4be9b6d8b359e9cea09))
* Correct APIError imports ([062e23b](https://github.com/HeyPuter/puter/commit/062e23b5c9673db1f8b0ff0469289d52dd1e3f99))
* Correct grep output when asking for line numbers ([c8a20ca](https://github.com/HeyPuter/puter/commit/c8a20cadbfd539d185d32f4558916825fcf265ba))
* Correct inverted instanceof check in SignalReader.read() ([d4c2b49](https://github.com/HeyPuter/puter/commit/d4c2b492ef4864804776d3cb7d24797fdc536886))
* Correct variables used in errors in sign.js ([fa7c6be](https://github.com/HeyPuter/puter/commit/fa7c6bee9699527028be0ae9759155bc67c52324))
* Eliminates duplicate translation keys ([5800350](https://github.com/HeyPuter/puter/commit/5800350b253994dea410afff64e3df2a171e7775))
* fix error handling for outdated node versions ([4c1d5a4](https://github.com/HeyPuter/puter/commit/4c1d5a4b6d009ce075897d499d3517219bd745a4))
* Fix phoenix app prefix and TokenService test ([afb9d86](https://github.com/HeyPuter/puter/commit/afb9d866b5091058711db931cde904947e661c15))
* increase QR code size ([d2de46e](https://github.com/HeyPuter/puter/commit/d2de46edfbc05d132d5c929f6935b82515fbbda0))
* Make PathCommandProvider reject queries with path separators ([d733119](https://github.com/HeyPuter/puter/commit/d73311945610417a1ebc7bb0723ced0a599594b4))
* Make url variable accessible to all users of it ([2f30ae7](https://github.com/HeyPuter/puter/commit/2f30ae7a825adcd8da95888c38fe39c34acee0ff))
* Only run Component initialization functions once ([5b43358](https://github.com/HeyPuter/puter/commit/5b43358219402bee3eadf4a0f184a4b924d3293b))
* Parse octal echo escapes ([6ad8f5e](https://github.com/HeyPuter/puter/commit/6ad8f5e06abd050d319271f818d72debf5bc8e44))
* reduce token lengths ([5a76bad](https://github.com/HeyPuter/puter/commit/5a76bad28dfd8ec89a309941e410a54927fae22d))
* reliability issue :bug: ([1d546d9](https://github.com/HeyPuter/puter/commit/1d546d9ef70ef9066ad5838e9782ae330d289f29))
* Remove null or duplicate app entries from suggest_app_for_fsentry() ([6900233](https://github.com/HeyPuter/puter/commit/6900233c5aaa2d1a49f495e9f9a060796757a91e))
* **security:** always use application/octet-stream ([74e213a](https://github.com/HeyPuter/puter/commit/74e213a534dbf2844c8cebeee7eb59ec70de306e))
* **security:** Fix session revocation ([eb166a6](https://github.com/HeyPuter/puter/commit/eb166a67a9f0caf4fd77f9e27dc8209c2fc51f4c))
* **security:** Move token for socket.io to request body ([49b257e](https://github.com/HeyPuter/puter/commit/49b257ecffbb1e12090b86a67528a5ad09da69db))
* **security:** Prevent email enumeration ([ed70314](https://github.com/HeyPuter/puter/commit/ed703146863f896df76c98fad7127c6748c0ef9b))
* **security:** skip cache when checking old passwd ([7800ef6](https://github.com/HeyPuter/puter/commit/7800ef61029c8d1ba47491b4028a0cb972298725))
* **Terminal:** Accept input from Chrome on Android ([4ef3e53](https://github.com/HeyPuter/puter/commit/4ef3e53de34f0097950a7e707ca2483863beafb5))
* test release-please action [#3](https://github.com/HeyPuter/puter/issues/3) ([8fb0a66](https://github.com/HeyPuter/puter/commit/8fb0a66ef21921990e564e5f61c0e80e7f929dc7))
* test release-please action [#4](https://github.com/HeyPuter/puter/issues/4) ([f392de7](https://github.com/HeyPuter/puter/commit/f392de722a5232b622ed91b656a31cdc443c2e84))
* typographical error :bug: ([2949f71](https://github.com/HeyPuter/puter/commit/2949f71691eb0a258888c5d2a5bb496d2fe64a23))
* typographical errors :bug: ([4d30740](https://github.com/HeyPuter/puter/commit/4d30740198402cd1cc61b9ea4c45e006b69ec87e))
* Use correct variable for version number ([52d5299](https://github.com/HeyPuter/puter/commit/52d52993744dffa9f7f59a232da5df9077560731))
* use primary read in signup ([30f17ad](https://github.com/HeyPuter/puter/commit/30f17ade3a893d2283316e581836607e2029f9b9))

## [2.2.0](https://github.com/HeyPuter/puter/compare/v2.1.1...v2.2.0) (2024-04-23)


### Features

* add /healthcheck endpoint ([c166560](https://github.com/HeyPuter/puter/commit/c166560ff4ab5a453d3ec4f97326c995deb7f522))
* allow apps to add a menubar via puter.js ([331d9e7](https://github.com/HeyPuter/puter/commit/331d9e75428ec7609394f59b1755374c7340f83e))

## [2.1.1](https://github.com/HeyPuter/puter/compare/v2.1.0...v2.1.1) (2024-04-22)


### Bug Fixes

* test release-please action [#3](https://github.com/HeyPuter/puter/issues/3) ([8fb0a66](https://github.com/HeyPuter/puter/commit/8fb0a66ef21921990e564e5f61c0e80e7f929dc7))
* test release-please action [#4](https://github.com/HeyPuter/puter/issues/4) ([f392de7](https://github.com/HeyPuter/puter/commit/f392de722a5232b622ed91b656a31cdc443c2e84))
