---
title: Supported Platforms
description: Use Puter.js on any platform with JavaScript support, including websites, Puter Apps, Node.js, and Serverless Workers.
---

Puter.js works on any platform with JavaScript support. This includes websites, Puter Apps, Node.js, and Puter Serverless Workers.

## **Websites**

Use Puter.js in your websites to add powerful features like AI, databases, and cloud storage without worrying about infrastructure.

You can use it across all kinds of web development technologies, from static HTML sites and single-page applications (React, Vue, Angular) to full-stack frameworks like Next.js, Nuxt, and SvelteKit, or any JavaScript-based web application.

<div style="overflow:hidden; margin-top: 30px;">
    <div class="example-group active" data-section="npm"><span>NPM module</span></div>
    <div class="example-group" data-section="cdn"><span>CDN (script tag)</span></div>
</div>

<div class="example-content" data-section="npm" style="display:block;">

### Installation via NPM

```plaintext
npm install @heyputer/puter.js
```

<br>

### Importing Puter.js

```js
// ESM
import { puter } from "@heyputer/puter.js";
// or
import puter from "@heyputer/puter.js";

// CommonJS
const { puter } = require("@heyputer/puter.js");
// or
const puter = require("@heyputer/puter.js");
```

</div>

<div class="example-content" data-section="cdn">

### Usage via CDN

```html;ai-chatgpt
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.chat(`What is life?`, { model: "gpt-5-nano" }).then(puter.print);
    </script>
</body>
</html>
```

</div>

### Starter templates for web

- [Angular](https://github.com/HeyPuter/angular)
- [React](https://github.com/HeyPuter/react)
- [Next.js](https://github.com/HeyPuter/next.js)
- [Vue.js](https://github.com/HeyPuter/vue.js)
- [Vanilla JS](https://github.com/HeyPuter/vanilla.js)

## **Puter Apps**

Puter Apps are web-based applications that run in the [Puter](https://puter.com) web-based operating system.

You can use Puter.js in Puter Apps just as you would in any website. They have full access to all web capabilities, plus the added benefits of Puter desktop, such as:

- **Automatic authentication** - Users are automatically authenticated in the Puter environment
- **Inter-app communication** - Interact with other Puter apps programmatically
- **File system integration** - Direct access to the user's Puter file system
- **Cloud desktop integration** - Apps run seamlessly in the Puter desktop environment

<figure style="margin: 40px 0;">
    <img src="https://assets.puter.site/puter.com-screenshot-3.webp" style="width: 100%; max-width: 600px; margin: 0px auto; display:block;">
    <figcaption style="text-align: center; font-size: 13px; color: #777;">Puter cloud desktop environment</figcaption>
</figure>

The Puter ecosystem hosts over 60,000 live applications, from essential tools like Notepad, File Explorer, Code Editor, and many more specialized applications.

## **Node.js**

Puter.js works seamlessly in Node.js environments, allowing you to integrate AI, databases, and cloud storage with your Node.js applications. This makes it ideal for building backend services and APIs, performing server-side data processing, or creating CLI tools and automation scripts.

```js
const { init } = require("@heyputer/puter.js/src/init.cjs");
// or
import { init } from "@heyputer/puter.js/src/init.cjs";

const puter = init(process.env.puterAuthToken); // uses your auth token

// Chat with GPT-5 nano
puter.ai.chat("What color was Napoleon's white horse?").then((response) => {
  puter.print(response);
});
```

Get started quickly with the [Node.js + Express template](https://github.com/HeyPuter/node.js-express.js).

<div class="info">If your environment has browser access (e.g. CLI tools), you can use <code>getAuthToken()</code> to obtain a token via web-based login.</div>

## **Serverless Workers**

[Serverless Workers](/Workers/) let you run HTTP servers and backend APIs.

Think of them as your serverless backend and API endpoints. Just like in other serverless platforms, you can use Puter.js in workers to access AI, cloud storage, key-value stores, and databases.

```js
// Simple GET endpoint
router.get("/api/hello", async ({ request }) => {
  return { message: "Hello, World!" };
});

// POST endpoint with JSON body
router.post("/api/user", async ({ request }) => {
  const body = await request.json();
  return { processed: true };
});
```
