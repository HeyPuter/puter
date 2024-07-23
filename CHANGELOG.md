# Changelog

## v2.4.2 (2024-07-22)

### Puter

#### Features

- add new file templates ([1f7f094](https://github.com/HeyPuter/puter/commit/1f7f094282fae915a2436701cfb756444cd3f781))
- add cross_origin_isolation option ([e539932](https://github.com/HeyPuter/puter/commit/e53993207077aecd2c01712519251993bb2562bc))
- add option to disable temporary users ([f9333b3](https://github.com/HeyPuter/puter/commit/f9333b3d1e05bd0dffaecd2e29afd08ea61559fc))
- add some default groups ([ba50d0f](https://github.com/HeyPuter/puter/commit/ba50d0f96d58075abec067d24e6532bd874093f0))
- Add support for dropping multiple Puter items onto Dev Center (close #311) ([8e7306c](https://github.com/HeyPuter/puter/commit/8e7306c23be01ee6c31cdb4c99f2fb1f71a2247f))

#### Translations

- Update ig.js ([382fb24](https://github.com/HeyPuter/puter/commit/382fb24dbb1737a8a54ed2491f80b2e2276cde61))
- feat: add vietnamese localization-a ([c2d3d69](https://github.com/HeyPuter/puter/commit/c2d3d69dbe33f36fcae13bcbc8e2a31a86025af9))
- Update zhtw.js, Complete Traditional Chinese translation based on English file #550 ([b9e73b7](https://github.com/HeyPuter/puter/commit/b9e73b7288aebb14e6bbf1915743e9157fc950b1))
- update zhtw.js to match en.js ([37fd666](https://github.com/HeyPuter/puter/commit/37fd666a9a6788d5f0c59311499f29896b48bc82))
- Add Tamil translation to translations.js ([8a3d043](https://github.com/HeyPuter/puter/commit/8a3d0430f39f872b8a460c344cce652c340b700b))
- Move Tamil translation to the rest of translations ([333d6e3](https://github.com/HeyPuter/puter/commit/333d6e3b651e460caca04a896cbc8c175555b79b))
- Translation improvements, mainly style and context-based ([8bece96](https://github.com/HeyPuter/puter/commit/8bece96f6224a060d5b408e08c58865fadb8b79c))
- update translation file es.js to be up to date with the file en.js ([1515278](https://github.com/HeyPuter/puter/commit/151527825f1eb4b060aaf97feb7d18af4fcddbf2))
- Translate en.js as of 2024-07-10 ([8e297cd](https://github.com/HeyPuter/puter/commit/8e297cd7e30757073e2f96593c363a273b639466))
- Create hu.js hungarian language ([69a80ab](https://github.com/HeyPuter/puter/commit/69a80ab3d2c94ee43d96021c3bcbdab04a4b5dc6))
- Update translations.js to Hungarian lang ([56820cf](https://github.com/HeyPuter/puter/commit/56820cf6ee56ff810a6b495a281ccbb2e7f9d8fb))
- Tamil translation ([81781f8](https://github.com/HeyPuter/puter/commit/81781f80afc07cd1e6278906cdc68c8092fbfedf))
- Update it.js ([84e31ef](https://github.com/HeyPuter/puter/commit/84e31eff2f58584d8fab7dd10606f2f6ced933a2))
- Update Armenian translation file ([3b8af7c](https://github.com/HeyPuter/puter/commit/3b8af7cc5c1be8ed67be827360bbfe0f0b5027e9))

#### Bug Fixes

- fix templates ([5d2a6fc](https://github.com/HeyPuter/puter/commit/5d2a6fce305a3dcd4857f52ebb75f529dffe4790))
- popup login in co isolation mode ([8f87770](https://github.com/HeyPuter/puter/commit/8f87770cebab32c00cb10133979d426306685292))
- add necessary iframe attributes for co isolation ([2a5cec7](https://github.com/HeyPuter/puter/commit/2a5cec7ee914c9c97ae90b85464f9fc5332ad2fb))
- chore: fix confirm for type_confirm_to_delete_account ([02e1b1e](https://github.com/HeyPuter/puter/commit/02e1b1e8f5f8e22d7ab39ebff99f7dd8e08a4221))
- syntax error and formatting issue ([3a09e84](https://github.com/HeyPuter/puter/commit/3a09e84838fe8b74bd050641620eec87d9f59dfc))
- #432 ([f897e84](https://github.com/HeyPuter/puter/commit/f897e844989083b0b369ba0ce4d2c5a9f3db5ad8))
- `launch_app` not considering `explorer` as a special case ([98e6964](https://github.com/HeyPuter/puter/commit/98e69642d027a83975a0b2b825317213098bb689))
- well kinda (HOSTNAME in phoenix) ([7043b94](https://github.com/HeyPuter/puter/commit/7043b9400c63842c4c54d82724167666708d3119))
- it was github actions the entire time ([602a198](https://github.com/HeyPuter/puter/commit/602a19895c05b45a7d283470e7af3ae786be1bf2))
- fix CI attempt #7 ([614f2c5](https://github.com/HeyPuter/puter/commit/614f2c5061525f230ccd879bfb047434ac46a9ba))
- fix CI attempt #6 ([9d549b1](https://github.com/HeyPuter/puter/commit/9d549b192d149eac96c316ded645bf7c2e96153d))
- fix CI attempt #5 ([74adcdd](https://github.com/HeyPuter/puter/commit/74adcddc1d60e0a513408a0716ed2b301126225d))
- fix CI attempt #4 ([84b993b](https://github.com/HeyPuter/puter/commit/84b993bce913c3ad99127063bcfaae19331b199c))
- fix CI attempt #3 ([3bca973](https://github.com/HeyPuter/puter/commit/3bca973f5f4e65a2bd24c634c347fbd681a7458b))
- fix CI attempt #2 ([aebe89a](https://github.com/HeyPuter/puter/commit/aebe89a1acb070764551e8e89e325325ffbed8f9))
- run mocha within packages in monorepo ([58c199c](https://github.com/HeyPuter/puter/commit/58c199c15356ac087a04b16dd18e8fe0f1aea359))
- make webpack output not look like errors ([ad3d318](https://github.com/HeyPuter/puter/commit/ad3d318d07377c78c0429247225655e489b68be4))
- No scrollbar for session list ([45f131f](https://github.com/HeyPuter/puter/commit/45f131f8eaf94cf3951ca7ffeb6f311590233b8a))
- fix path issues under win32 platform ([d80f2fa](https://github.com/HeyPuter/puter/commit/d80f2fa847bfaef98dc8d482898f5c15f268e4bd))
- remove abnoxious debug file ([5c636d4](https://github.com/HeyPuter/puter/commit/5c636d4fd25e14ba3813f7fca3b70ff7bd6860e7))
- read_only fields in ES ([e8f4c32](https://github.com/HeyPuter/puter/commit/e8f4c328bff5c36b95fe460b80803e12e619f8ee))

### Security

#### Bug Fixes

- hoist acl check in ll_read ([6a2fbc1](https://github.com/HeyPuter/puter/commit/6a2fbc1925952ecceed741afe138270d1eeda7b7))

## v2.4.1 (2024-07-11)

### Puter


#### Features

- update BR translation ([42a6b39](https://github.com/HeyPuter/puter/commit/42a6b3938a588b8b4d1bd976c37e9c6e58408c75))
- JSON support for kv driver ([3ed7916](https://github.com/HeyPuter/puter/commit/3ed7916856f03eafbe0891f2ab39c34d20d2bd24))

#### Translations

- Update bn.js file formatting ([cff488f](https://github.com/HeyPuter/puter/commit/cff488f4f4378ca6c7568a585a665f2a3b87b89c))
- Issue#530 - Update bengali translations ([92abc99](https://github.com/HeyPuter/puter/commit/92abc9947f811f94f17a5ee5a4b73ee2b210900a))
- Added missing Romanian translations. ([8440f56](https://github.com/HeyPuter/puter/commit/8440f566b91c9eb4f01addcb850061e3fbe3afc7))
- Add 2FA Romanian translations ([473b651](https://github.com/HeyPuter/puter/commit/473b6512c697854e3f3badae1eb7b87742954da5))
- Add Japanese Translation ([47ec74f](https://github.com/HeyPuter/puter/commit/47ec74f0aa6adb3952e6460909029a4acb0c3039))
- Completing Italian translation based on English file ([f5a8ee1](https://github.com/HeyPuter/puter/commit/f5a8ee1c6ab950d62c90b6257791f026a508b4e4))
- Completing Italian translation based on English file. ([a96abb5](https://github.com/HeyPuter/puter/commit/a96abb5793528d0dc56d75f95d771e1dcf5960d1))
- Completing Arabic translation based on English file ([78a0ace](https://github.com/HeyPuter/puter/commit/78a0acea6980b6d491da4874edbd98e17c0d9577))
- Update Arabic translations in src/gui/src/i18n/translations/ar.js to match English version in src/gui/src/i18n/translations/en.js ([fe5be7f](https://github.com/HeyPuter/puter/commit/fe5be7f3cf7f336730137293ba86a637e8d8591d))
- Update Arabic translations in src/gui/src/i18n/translations/ar.js to match English version in src/gui/src/i18n/translations/en.js ([bffa192](https://github.com/HeyPuter/puter/commit/bffa192805216fc17045cd8d629f34784dca7f3f))
- Ukrainian updated ([e61039f](https://github.com/HeyPuter/puter/commit/e61039faf409b0ad85c7513b0123f3f2e92ebe32))
- Update ru.js issue #547 ([17145d0](https://github.com/HeyPuter/puter/commit/17145d0be6a9a1445947cc0c4bec8f16a475144c))
- Russian translation fixed ([8836011](https://github.com/HeyPuter/puter/commit/883601142873f10d69c84874499065a7d29af054))

#### Bug Fixes

- remove flag that breaks puter-js webpack ([7aadae5](https://github.com/HeyPuter/puter/commit/7aadae58ce1a51f925bf64c3d65ac1fa6971b164))
- Improve `getMimeType` to remove trailing dot in the extension if preset ([535475b](https://github.com/HeyPuter/puter/commit/535475b3c36a37e3319ed067a24fb671790dcda3))


## 2.4.0 (2024-07-08)


### Features

* add (pt-br) translation for system settings. ([77211c4](https://github.com/HeyPuter/puter/commit/77211c4f71b0285fb3060f7e5c8d493b4d7c4f0c))
* add /group/list endpoint ([d55f38c](https://github.com/HeyPuter/puter/commit/d55f38ca68899c3574cfe328d2b206b1143ff0d4))
* add /share/file-by-username endpoint ([5d214c7](https://github.com/HeyPuter/puter/commit/5d214c7b52887b594af6be497f1892baf7d77679))
* add /sharelink/request endpoint ([742f625](https://github.com/HeyPuter/puter/commit/742f625309f9f4cfa70cf7d2fe5b03fd164913ea))
* add /show urls ([079e25a](https://github.com/HeyPuter/puter/commit/079e25a9fe8e179f26d72378856058eb656e2314))
* add app metadata ([f7216b9](https://github.com/HeyPuter/puter/commit/f7216b95672b38802b288ef5b022e947017ff311))
* add appdata permission (if applicable) on app share ([9751fd9](https://github.com/HeyPuter/puter/commit/9751fd92a50e75385cffed0ca847d5076ba98c92))
* add cookie for site token ([a813fbb](https://github.com/HeyPuter/puter/commit/a813fbbb88bcfb8b9a61976e2a4fc4aab943fc88))
* add cross-server event broadcasting ([1207a15](https://github.com/HeyPuter/puter/commit/1207a158bdc88a90b14d31d03387ce353c176a9c))
* add debug mod ([16b1649](https://github.com/HeyPuter/puter/commit/16b1649ff62fd87a4dda5d2e1c68941c864c5da4))
* add endpoints for share tokens ([301ffaf](https://github.com/HeyPuter/puter/commit/301ffaf61dbb4fca1a855650ab80707ae6d9f602))
* Add exit status code to apps ([7674da4](https://github.com/HeyPuter/puter/commit/7674da4cd225bcad34079251c5600fc32e32248b))
* add external mod loading ([eb05fbd](https://github.com/HeyPuter/puter/commit/eb05fbd2dc4877553b5118a069a9afdc32bea137))
* add group management endpoints ([4216346](https://github.com/HeyPuter/puter/commit/4216346384d90dcba429dbcb175e6f86482d19f4))
* add group permission endpoints ([c374b0c](https://github.com/HeyPuter/puter/commit/c374b0cbca761e7c8a47d56a09551f2e9378066a))
* add mark-read endpoint ([0101f42](https://github.com/HeyPuter/puter/commit/0101f425d480705c20df4919a76f66e987f5790f))
* add permission rewriter for app by name ([16c4907](https://github.com/HeyPuter/puter/commit/16c4907be592dae31ed3c1aa3fac3b9655255d6f))
* add protected apps ([f2f3d6f](https://github.com/HeyPuter/puter/commit/f2f3d6ff460932698fb8da7309fbce3e96132950))
* add protected subdomains ([86fca17](https://github.com/HeyPuter/puter/commit/86fca17fb17c0c24397c29b49b133deadea1de8b))
* add querystring-informed errors ([e7c0b83](https://github.com/HeyPuter/puter/commit/e7c0b8320a6829315d9154d6d513bab4491c47ea))
* add readdir delegate for shares in a user directory ([8424d44](https://github.com/HeyPuter/puter/commit/8424d446099ac30ccf829c57d43eef1f235618e4))
* add readdir delegate for sharing user homedirs ([19a5eb0](https://github.com/HeyPuter/puter/commit/19a5eb00763f3ac31df8483fb59cb7a96c448745))
* add service for notifications ([a1e6887](https://github.com/HeyPuter/puter/commit/a1e6887bf93da21b9482040b3e30ee083fb23477))
* add service to test file share logic ([332371f](https://github.com/HeyPuter/puter/commit/332371fccb198462948a440419adc7a26d671a23))
* add share list to stat ([8c49ba2](https://github.com/HeyPuter/puter/commit/8c49ba2553ce6bee20eb5b6f2721bc80f639e98a))
* add share service and share-by-email to /share ([db5990a](https://github.com/HeyPuter/puter/commit/db5990a98935817c0e16d30e921bb99c57a98fc8))
* add subdomain permission (if applicable) on app share ([13e2f72](https://github.com/HeyPuter/puter/commit/13e2f72c9f33f485570f13f45341246b1a05879f))
* add user-group permission check ([0014940](https://github.com/HeyPuter/puter/commit/00149402e041443aa3ac571fbe97a9a85f95564b))
* **backend:** add script service ([30550fc](https://github.com/HeyPuter/puter/commit/30550fcddda18469735499546de502d29b85e2ad))
* **backend:** Add tab completion to server console command arguments ([fa81dca](https://github.com/HeyPuter/puter/commit/fa81dca9507b7fa0f82099b75f2ab89c865626ac))
* **backend:** Add tab-completion to server console command names ([e1e76c6](https://github.com/HeyPuter/puter/commit/e1e76c6be71fdeb3b6246307b626734d8dc26f86))
* **backend:** add tip of day ([2d8e624](https://github.com/HeyPuter/puter/commit/2d8e6240c61dc6301f49cbdcd1c3b04736f9ca93))
* **backend:** allow services to provide user properties ([522664d](https://github.com/HeyPuter/puter/commit/522664d415c33342500defec309c2ff15bc94804))
* **backend:** allow services to provide whoami values ([fccabf1](https://github.com/HeyPuter/puter/commit/fccabf1bc0c4418f3599222616dd63bf98c14fe1))
* **backend:** improve logger and reduce logs ([4bdad75](https://github.com/HeyPuter/puter/commit/4bdad75766d0617a164024b39b79bf5373c495a6))
* Display app icon and description in embeds ([ef298ce](https://github.com/HeyPuter/puter/commit/ef298ce3aa3ce90224e883fb0ba33f9cd3a3da44))
* get first test working on share-test service ([88d6bee](https://github.com/HeyPuter/puter/commit/88d6bee9546f36d689c53ec7fe95f01f772f5211))
* **git:** Add --color and --no-color options ([d6dd1a5](https://github.com/HeyPuter/puter/commit/d6dd1a5bb0a2b2bba2cfe86d2e51ff2a6e42841c))
* **git:** Add a --debug option, which sets the DEBUG global ([fa3df72](https://github.com/HeyPuter/puter/commit/fa3df72f6ed2d45a440ebc2aacbbae67bf042478))
* **git:** Add authentication to clone, fetch, and pull. ([364d580](https://github.com/HeyPuter/puter/commit/364d580ff896691ee70d3735f495c720651a9f41))
* **git:** Add diff display to `show` and `log` subcommands ([3cad1ec](https://github.com/HeyPuter/puter/commit/3cad1ec436f99a78f782ab9576325d4341284964))
* **git:** Add start-revision and file arguments to `git log` ([49c2f16](https://github.com/HeyPuter/puter/commit/49c2f163515d2130c17a6f6a6a16bc27ea69336a))
* **git:** Allow checking out a commit instead of a branch ([057b3ac](https://github.com/HeyPuter/puter/commit/057b3acf00af49c005b9bf7069c5d22983a32e1e))
* **git:** Color output for `git status` files ([bab5204](https://github.com/HeyPuter/puter/commit/bab5204209aa2efc0c053643677a78db6ede0929))
* **git:** Display file contents as a string for `git show FILE_OID` ([a680371](https://github.com/HeyPuter/puter/commit/a68037111a04580cfa2688694a68ef6ac7a495fa))
* **git:** Display ref names in `git log` and `git show` ([45cdfcb](https://github.com/HeyPuter/puter/commit/45cdfcb5bfa66937b33054a127e0b17001f3faa4))
* **git:** Format output closer to canonical git ([60976b1](https://github.com/HeyPuter/puter/commit/60976b1ed61984d9d290f3a0ae99dd97632e9909))
* **git:** Handle detached HEAD in `git status` and `git branch --list` ([2c9b1a3](https://github.com/HeyPuter/puter/commit/2c9b1a3ffc3d5e282ffe5b83a86314e99445bbc6))
* **git:** Implement `git branch` ([ad4f132](https://github.com/HeyPuter/puter/commit/ad4f13255d52f8226f22800c16b388cf0e6384d7))
* **git:** Implement `git checkout` ([35e4453](https://github.com/HeyPuter/puter/commit/35e4453930bc4e151887f83c97efec19cc15da70))
* **git:** Implement `git cherry-pick` ([2e4259d](https://github.com/HeyPuter/puter/commit/2e4259d267b3cfafd5cefc57a02643c6432fec4d))
* **git:** Implement `git clone` ([95c8235](https://github.com/HeyPuter/puter/commit/95c8235a4a1fea39a46c40df04cb1004a2fe7b23))
* **git:** Implement `git diff` ([622b6a9](https://github.com/HeyPuter/puter/commit/622b6a9b921c3c03efc0b519c9a26c6701d80e50))
* **git:** Implement `git fetch` ([98a4b9e](https://github.com/HeyPuter/puter/commit/98a4b9ede39b94c0c6b6b8345d7551359961186a))
* **git:** Implement `git pull` ([eb2b6a0](https://github.com/HeyPuter/puter/commit/eb2b6a08b03cee0612885412cd4b03c9564044e3))
* **git:** Implement `git push` ([8c70229](https://github.com/HeyPuter/puter/commit/8c70229a188b743220db076a740a992fd7971301))
* **git:** Implement `git remote` ([43ce0d5](https://github.com/HeyPuter/puter/commit/43ce0d5b45d4eb4f296afcaaa1ecadc125c53e89))
* **git:** Implement `git restore` ([4ba8a32](https://github.com/HeyPuter/puter/commit/4ba8a32b45d395f28433572db5644d630776789e))
* **git:** Make `git add` work for deleted files ([9551544](https://github.com/HeyPuter/puter/commit/955154468f48e45028dad2e916708d6a763affad))
* **git:** Make shorten_hash() guaranteed to produce a unique hash ([dd10a37](https://github.com/HeyPuter/puter/commit/dd10a377493c0d8f10a1ac8779dc27f3f3bf6c37))
* **git:** Resolve more forms of commit reference ([b6906bb](https://github.com/HeyPuter/puter/commit/b6906bbcaaa50fc8a8c60beb6d2d38bcb7dda758))
* **git:** Understand references like `HEAD^` and `main~3` ([711dbc0](https://github.com/HeyPuter/puter/commit/711dbc0d2fde9c2ddc6c86f64fb4caa7837c9dcb))
* implicit access from apps to shared appdata dirs ([31d4eb0](https://github.com/HeyPuter/puter/commit/31d4eb090efb340fdfb7cb6b751145e859624eeb))
* introduce notification selection via driver ([c5334b0](https://github.com/HeyPuter/puter/commit/c5334b0e19cf9762f536ec482c3ff872e9c12399))
* multi-recipient multi-file share endpoint ([846fdc2](https://github.com/HeyPuter/puter/commit/846fdc20d4a887a1f8a4f3bda4fafe41efab2733))
* **parsely:** Add a fail() parser ([5656d9d](https://github.com/HeyPuter/puter/commit/5656d9d42f76202a534ad640d3a4e287e0e40418))
* **parsely:** Add stringUntil() parser ([d46b043](https://github.com/HeyPuter/puter/commit/d46b043c5d16f1205d61de3f3ba43ed8ad7bff93))
* **phoenix:** Add --dump and --file options to sed ([f250f86](https://github.com/HeyPuter/puter/commit/f250f86446a506f24fa2ad396328e3a2212a68d0))
* **phoenix:** Add more commands to sed, including labels and branching ([306014a](https://github.com/HeyPuter/puter/commit/306014adc77a7ca155feb95d1146cb46ee075b52))
* **phoenix:** Expose parsed arg tokens to apps that request them ([4067c82](https://github.com/HeyPuter/puter/commit/4067c82486c99cad20f41927ad39ebea438b717f))
* **phoenix:** Implement an `exit` builtin ([3184d34](https://github.com/HeyPuter/puter/commit/3184d3482c7b95c0fd1fc0745555ff82fc9a8c99))
* **phoenix:** Implement parsing of sed scripts ([0d4f907](https://github.com/HeyPuter/puter/commit/0d4f907b6675b15bd50a55f50aa28f0803b18b7b))
* **phoenix:** Make `clear` clear scrollback unless `-x` is given ([75a989a](https://github.com/HeyPuter/puter/commit/75a989a7b69bfdfdf69e5f0365027c5b27d8bfc6))
* **Phoenix:** Pass command line arguments and ENV when launching apps ([8f1c4fc](https://github.com/HeyPuter/puter/commit/8f1c4fcda98e72a7b970e8c6fc2fe39a5e012264))
* **phoenix:** Respond to exit status codes ([5de3052](https://github.com/HeyPuter/puter/commit/5de305202656a172b187dac87543d6c1c69a2958))
* **phoenix:** Show actual host name in prompt and neofetch ([4539408](https://github.com/HeyPuter/puter/commit/4539408a218a50244dc615cf7de56c29dcac53e6))
* rate-limit for excessive groups ([4af279a](https://github.com/HeyPuter/puter/commit/4af279a72fc9de89ddc3ba51806ca3760a36265d))
* re-send unreads on login ([02fc4d8](https://github.com/HeyPuter/puter/commit/02fc4d86b7166fb4803be5d28e2a593d6b7d9785))
* register dev center to apps ([10f4d7d](https://github.com/HeyPuter/puter/commit/10f4d7d50ce9314f9c3888c74cb17c8ebbecee98))
* send notification when file gets shared ([2f6c428](https://github.com/HeyPuter/puter/commit/2f6c428a403a006f7878861d2f0356c3294519be))
* start directory index frame ([fb1e2f2](https://github.com/HeyPuter/puter/commit/fb1e2f21fb67aefe0602f6c978199c7cd019bbf7))
* support canonical puter.js url in dev ([fd41ae2](https://github.com/HeyPuter/puter/commit/fd41ae217c7a9f7229326f62a829471580a744bd))
* **ui:** add new components ([577bd59](https://github.com/HeyPuter/puter/commit/577bd59b6cc94810e851ad544f8234e25a4e6e27))
* **ui:** add new components ([38ba425](https://github.com/HeyPuter/puter/commit/38ba42575ce9f3506f8ce219b9580202b3ed9993))
* **ui:** allow component-based settings tabs ([1245960](https://github.com/HeyPuter/puter/commit/124596058a286241b51dd87ce2fc1a68478cb5b8))
* update share endpoint to support more things ([dd5fde5](https://github.com/HeyPuter/puter/commit/dd5fde5130c1840ab598e6622766ae835142e58a))


### Bug Fixes

* add app_uid param to kv interface ([f7a0549](https://github.com/HeyPuter/puter/commit/f7a054956b8739a3bc305a49faee929ea0da1e15))
* add missing columns for public directory update ([b10302a](https://github.com/HeyPuter/puter/commit/b10302ad744fd9c58f9735743e075815183c772c))
* Add missing file extension to 0009_app-prefix-fix.sql in DB init ([a8160a8](https://github.com/HeyPuter/puter/commit/a8160a8cdcdd6aff98728a6f1643d93386e6bb5a))
* add permission implicator for file modes ([e63ab3a](https://github.com/HeyPuter/puter/commit/e63ab3a67f6555eb13d6af477a8da9f1b54d6608))
* add stream limit ([ceba309](https://github.com/HeyPuter/puter/commit/ceba309dbd4df89f310d1a530f939a5b7991f4c7))
* **backend:** remove a bad thing that really doesn't work ([8d22276](https://github.com/HeyPuter/puter/commit/8d22276f13106f7642d11da30b1500817a20ad43))
* bug introduced when refactoring /share to Sequence ([ecb9978](https://github.com/HeyPuter/puter/commit/ecb997885c1efb766827c84d2ffb8dc6ddabe992))
* check subdomain earlier for /apps ([4e3a24e](https://github.com/HeyPuter/puter/commit/4e3a24e6093e279e210765e07e436f4e63b74072))
* column nullability blunder ([1429d6f](https://github.com/HeyPuter/puter/commit/1429d6f57c67dff51fc41ca0c2868f8d000845f1))
* Correct APIError imports ([062e23b](https://github.com/HeyPuter/puter/commit/062e23b5c9673db1f8b0ff0469289d52dd1e3f99))
* correct shown flag behavior ([632c536](https://github.com/HeyPuter/puter/commit/632c5366161ff8fbbd4d60c61dfbe52dad488a2c))
* database migration ([9b39309](https://github.com/HeyPuter/puter/commit/9b39309e18a2927d25fe794d91da4e4d068c4bca))
* do not delegate to select on read like ever that is really dumb ([a2a10b9](https://github.com/HeyPuter/puter/commit/a2a10b94be59403e03fb08bec5d7c056ce5b554f))
* docker runtime fail because stdout columns ([94c0449](https://github.com/HeyPuter/puter/commit/94c0449437ce4cb26d00a15a3f277bc7b09367b4))
* fix issues with apps in /share endpoint ([0cf90ee](https://github.com/HeyPuter/puter/commit/0cf90ee39af6548d271dec45ed8ee9e6df1cd14d))
* fix owner ids for default apps ([283f409](https://github.com/HeyPuter/puter/commit/283f409a662d126e7f3ce811f1467ac6fab9a522))
* fix permission cascade properly this time ([de58866](https://github.com/HeyPuter/puter/commit/de5886698e1eae2b250baac174b57029f3244e96))
* Fix phoenix app prefix and TokenService test ([afb9d86](https://github.com/HeyPuter/puter/commit/afb9d866b5091058711db931cde904947e661c15))
* fix that fix ([b126b67](https://github.com/HeyPuter/puter/commit/b126b670940a0e20cfe7bd0eba3db891bab5c142))
* fix typo ([ce328b7](https://github.com/HeyPuter/puter/commit/ce328b7245ad741b64c5885f64f806fc98a55d84))
* **git:** Make git commit display detached HEAD correctly ([73d0f5a](https://github.com/HeyPuter/puter/commit/73d0f5a90cb5dcbadfc6d0fd22f14e8bc0e61f86))
* group permission audit table ([7d2f6d2](https://github.com/HeyPuter/puter/commit/7d2f6d256f56e30d752e9999c6e8bde68f9d9637))
* handle subpaths under another user ([d128cee](https://github.com/HeyPuter/puter/commit/d128ceed6f4928fa0793815feb2e2715cd273ff8))
* handling of batch requests with zero files ([c0063a8](https://github.com/HeyPuter/puter/commit/c0063a871fd891a1774f1bee00e86170fed249fa))
* i forgot to test reloading ([7eabb43](https://github.com/HeyPuter/puter/commit/7eabb43bd4257b4129d67eaeda2aa27e8268dc78))
* improve console experience on mac ([15465bf](https://github.com/HeyPuter/puter/commit/15465bfc5035a64762f7c86a3d38af8be6be5b59))
* incorrect error from suggested_apps ([b648817](https://github.com/HeyPuter/puter/commit/b648817f2743c2b6214ebe4177d921c9b9027594))
* Make polyfilled import.meta.filename getter a valid function ([85c6798](https://github.com/HeyPuter/puter/commit/85c679844869b6b05fcbda231d8dc7026a66da97))
* null email in request to /share ([bf63144](https://github.com/HeyPuter/puter/commit/bf63144f7a79c48bd650ae851ddd0c8a10d748c3))
* Only run Component initialization functions once ([5b43358](https://github.com/HeyPuter/puter/commit/5b43358219402bee3eadf4a0f184a4b924d3293b))
* oops ([a136ee5](https://github.com/HeyPuter/puter/commit/a136ee5edd3149798a0d82f494f423f503b65f00))
* **parsely:** Make Repeat parser work when no separator is given ([9b4d16f](https://github.com/HeyPuter/puter/commit/9b4d16fbe9d5698c57f9da725a22b528a7d7cac2))
* peers array assumption ([10cbf08](https://github.com/HeyPuter/puter/commit/10cbf08233620440aa39f5302deaac4f59f02247))
* **phoenix:** Add missing newlines to sed command output ([e047b0b](https://github.com/HeyPuter/puter/commit/e047b0bf302284da61e677432e4cc25b531b24f2))
* **phoenix:** Gracefully handle completing a non-existent path ([d76e713](https://github.com/HeyPuter/puter/commit/d76e7130cba9f0ca05940abafe4fd1a41464aa83))
* property validation on some permission endpoints ([0855f2b](https://github.com/HeyPuter/puter/commit/0855f2b36eca3bbdaa8429cbde3aa1242e8e96ee))
* readdir on file ([a72ec97](https://github.com/HeyPuter/puter/commit/a72ec9799ac3bd76ceafa22cce149e373a13f3b9))
* remove last component when share URL is file ([1166e69](https://github.com/HeyPuter/puter/commit/1166e69c76688d1811701c56cd4df9d38e286793))
* remove legacy permission check in stat ([f2c6e01](https://github.com/HeyPuter/puter/commit/f2c6e01296e4214336e63bc2d69bcbf17f59890f))
* Remove null or duplicate app entries from suggest_app_for_fsentry() ([6900233](https://github.com/HeyPuter/puter/commit/6900233c5aaa2d1a49f495e9f9a060796757a91e))
* **security:** Move token for socket.io to request body ([49b257e](https://github.com/HeyPuter/puter/commit/49b257ecffbb1e12090b86a67528a5ad09da69db))
* switch share notif username to sender ([cd65217](https://github.com/HeyPuter/puter/commit/cd65217f5cda1c986ee231e2eeeef5abefa36ecb))
* **Terminal:** Accept input from Chrome on Android ([4ef3e53](https://github.com/HeyPuter/puter/commit/4ef3e53de34f0097950a7e707ca2483863beafb5))
* Throw an error when readdir is called on a non-directory ([46eb4ed](https://github.com/HeyPuter/puter/commit/46eb4ed2b96c235e10e15645a30d2f192a1af0de))
* type error in puter-site ([d96f924](https://github.com/HeyPuter/puter/commit/d96f924cad7a13ea6e9084bb0ebb79ecc5fcb8a3))
* ui color input attributes ([d9c4fbb](https://github.com/HeyPuter/puter/commit/d9c4fbbd1dcce12ee05ee33652a5fa518196463d))
* **ui:** improve Component base class ([f8780d0](https://github.com/HeyPuter/puter/commit/f8780d032b10138851c22af53b8610c578139acc))
* update email share object ([9033f6f](https://github.com/HeyPuter/puter/commit/9033f6f8c74ef8739294d640ac1c7eba95519bbd))
* update PD alert custom details ([2f16322](https://github.com/HeyPuter/puter/commit/2f163221bdde09425cae11ef7f8e4eb0b10c7103))
* update test kernel ([55c609b](https://github.com/HeyPuter/puter/commit/55c609b3fec4ef018febc6e88c44a6277960d728))
* validate size metadata ([2008db0](https://github.com/HeyPuter/puter/commit/2008db08524259264a0c8186a34fc75d7a133f5f))

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
