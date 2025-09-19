# Puter.js

The official JavaScript SDK for [Puter.com](https://puter.com) — access cloud and AI features directly from your frontend code.

---

## Installation (npm)

```sh
npm install @heyputer/puterjs
```

### Importing

#### ES Modules

```js
import puter from '@heyputer/puterjs';
```

#### CommonJS

```js
const puter = require('@heyputer/puterjs');
```

## Usage Example

```js
// Print a message
puter.print('Hello from Puter.js!');

// Chat with GPT-3.5 Turbo
puter.ai.chat('What color was Napoleon\'s white horse?').then(response => {
  puter.print(response);
});
```

---

## CDN Usage

Include Puter.js directly in your HTML via CDN:

```html
<script src="https://js.puter.com/v2/"></script>
<script>
  puter.print('Hello from Puter.js via CDN!');
  puter.ai.chat('What color was Napoleon\'s white horse?').then(response => {
    puter.print(response);
  });
</script>
```

---

## Documentation & Community

- [Docs](https://docs.puter.com)
- [Live Demo](https://docs.puter.com/playground/)
- [Puter.com](https://puter.com)
- [Discord](https://discord.com/invite/PQcx7Teh8u)
- [Reddit](https://reddit.com/r/puter)
- [X (Twitter)](https://twitter.com/HeyPuter)

---

## Local Development Example

Make sure the development server is running.

```html
<html>
<body>
    <script src="http://puter.localhost:4100/sdk/puter.dev.js"></script>
    <script>
        // Loading ...
        puter.print(`Loading...`);

        // Chat with GPT-3.5 Turbo
        puter.ai.chat(`What color was Napoleon's white horse?`).then((response) => {
            puter.print(response);
        });
    </script>
</body>
</html>
