# Puter.js

The official JavaScript SDK for [Puter.com](https://puter.com) — Free, Serverless, Cloud and AI from the frontend code.

---

## Installation (npm)

```sh
npm install @heyputer/puter.js
```

### Importing

### Node.js (with Auth Token)

```js
const {init} = require("@heyputer/puter.js/src/init.cjs"); // NODE JS ONLY
// or
import {init} from "@heyputer/puter.js/src/init.cjs";

const puter = init(process.env.puterAuthToken); // uses your auth token
const puter2 = init(process.env.puterAuthToken2); // use some other auth token
```

### Browser (without Auth Token)

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

#### CDN

Include Puter.js directly in your HTML via CDN in the `<head>` section:

```html
<script src="https://js.puter.com/v2/"></script>
```

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

---

## Documentation & Community

- [Developer Site](https://developer.puter.com)
- [API Docs](https://docs.puter.com)
- [Live Demo](https://docs.puter.com/playground/)
- [Puter.com](https://puter.com)
- [Discord](https://discord.com/invite/PQcx7Teh8u)
- [Reddit](https://reddit.com/r/puter)
- [X (Twitter)](https://twitter.com/HeyPuter)