<h3 align="center">Puter.js</h3>

<p align="center">The official JavaScript SDK for <a href="https://puter.com">Puter.com</a></p>
<p align="center">Free, Serverless, Cloud and AI from the frontend code.</p>

<p align="center">
    <a href="https://developer.puter.com" target="_blank">Learn More</a>
    ·
    <a href="https://docs.puter.com" target="_blank">Docs</a>
    ·
    <a href="https://developer.puter.com/tutorials">Tutorials</a>
    ·
    <a href="https://github.com/Puter-Apps/">Examples</a>
    ·
    <a href="https://twitter.com/HeyPuter">X</a>
</p>


<br>

## Installation


### NPM:
```sh
npm install @heyputer/puter.js
```

### CDN:

Include Puter.js directly in your HTML via CDN in the `<head>` section:

```html
<script src="https://js.puter.com/v2/"></script>
```
<br>

## Usage

### Browser

#### ES Modules

```js
import {puter} from '@heyputer/puter.js';
// or
import puter from '@heyputer/puter.js';
// or 
import '@heyputer/puter.js'; // puter will be available globally
```

#### CommonJS

```js
const {puter} = require('@heyputer/puter.js');
// or
const puter = require('@heyputer/puter.js');
// or
require('@heyputer/puter.js'); // puter will be available globally
```

### Node.js (with Auth Token)

```js
const {init} = require("@heyputer/puter.js/src/init.cjs"); // NODE JS ONLY
// or
import {init} from "@heyputer/puter.js/src/init.cjs";

const puter = init(process.env.puterAuthToken); // uses your auth token
const puter2 = init(process.env.puterAuthToken2); // use some other auth token
```

<br>

## Usage Example

After importing, you can use the global `puter` object:

```js
// Print a message
puter.print('Hello from Puter.js!');

// Chat with GPT-5 nano
puter.ai.chat('What color was Napoleon\'s white horse?').then(response => {
  puter.print(response);
});
```

<br>

## Setting Custom Origins
By default puter.js uses the official Puter API and GUI origins. You can customize these origins by setting global variables before importing the SDK like so:

```js
// For API origin
globalThis.PUTER_API_ORIGIN = 'https://custom-api.puter.com';
// For GUI origin
globalThis.PUTER_ORIGIN = 'https://custom-gui.puter.com';

import {puter} from '@heyputer/puter.js'; // or however you import it for your env
```
<br>

---

## Documentation & Community

- [Developer Site](https://developer.puter.com)
- [API Docs](https://docs.puter.com)
- [Live Demo](https://docs.puter.com/playground/)
- [Puter.com](https://puter.com)
- [Discord](https://discord.com/invite/PQcx7Teh8u)
- [Reddit](https://reddit.com/r/puter)
- [X (Twitter)](https://twitter.com/HeyPuter)

## License

Apache-2.0