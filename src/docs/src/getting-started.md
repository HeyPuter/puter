---
title: Getting Started
description: Get started with Puter.js for building your applications. No backend code, just add Puter.js and you're ready to start.
---

## Quick Start

Install Puter.js using NPM or include it directly via CDN.

<div style="overflow:hidden; margin-top: 30px;">
    <div class="example-group active" data-section="npm"><span>NPM module</span></div>
    <div class="example-group" data-section="cdn"><span>CDN (script tag)</span></div>
</div>

<div class="example-content" data-section="npm" style="display:block;">

#### Install

```plaintext
npm install @heyputer/puter.js
```

<br>

#### Use in the browser

```js
import { puter } from "@heyputer/puter.js";

// Example: Use AI to answer a question
puter.ai.chat(`Why did the chicken cross the road?`).then(console.log);
```

<br>

#### Use in Node.js

Initialize Puter.js with your auth token using the `init` function:

```js
import { init } from "@heyputer/puter.js/src/init.cjs";
const puter = init(process.env.puterAuthToken);

// Example: Use AI to answer a question
puter.ai.chat("What color was Napoleon's white horse?").then(console.log);
```

If your environment has browser access, you can obtain a token via browser login:

```js
import { init, getAuthToken } from "@heyputer/puter.js/src/init.cjs";

const authToken = await getAuthToken(); // performs browser based auth
const puter = init(authToken);
```

</div>

<div class="example-content" data-section="cdn">

#### Include the script

```html
<script src="https://js.puter.com/v2/"></script>
```

<br>

#### Use in the browser

```html
<html>
  <body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
      puter.ai.chat(`Why did the chicken cross the road?`).then(puter.print);
    </script>
  </body>
</html>
```

</div>

## Starter templates

Additionally, you can use one of the following starter templates to get started:

<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; margin-top: 24px;">
    <a href="https://github.com/HeyPuter/react" target="_blank" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; border: 1px solid #e2e4ef; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; background: #fff;">
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px; margin-bottom: 12px;" viewBox="0 0 512 512"><circle cx="256" cy="256" r="36" fill="#61dafb"/><path fill="#61dafb" d="M256 144c-74.4 0-138.6 16.5-176.3 41.5C42.4 210.5 16 243.2 16 256s26.4 45.5 63.7 70.5C117.4 351.5 181.6 368 256 368s138.6-16.5 176.3-41.5c37.3-25 63.7-57.7 63.7-70.5s-26.4-45.5-63.7-70.5C394.6 160.5 330.4 144 256 144zm0 192c-44.2 0-80-35.8-80-80s35.8-80 80-80 80 35.8 80 80-35.8 80-80 80z" opacity="0"/><ellipse cx="256" cy="256" rx="220" ry="70" fill="none" stroke="#61dafb" stroke-width="16"/><ellipse cx="256" cy="256" rx="220" ry="70" fill="none" stroke="#61dafb" stroke-width="16" transform="rotate(60 256 256)"/><ellipse cx="256" cy="256" rx="220" ry="70" fill="none" stroke="#61dafb" stroke-width="16" transform="rotate(120 256 256)"/></svg>
        <span style="font-size: 14px; font-weight: 500; color: #333;">React</span>
    </a>
    <a href="https://github.com/HeyPuter/next.js" target="_blank" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; border: 1px solid #e2e4ef; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; background: #fff;">
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px; margin-bottom: 12px;" viewBox="0 0 180 180"><mask id="a" width="180" height="180" x="0" y="0" maskUnits="userSpaceOnUse" style="mask-type:alpha"><circle cx="90" cy="90" r="90" fill="#000"/></mask><g mask="url(#a)"><circle cx="90" cy="90" r="90" fill="#000"/><path fill="url(#b)" d="M149.508 157.52L69.142 54H54v71.97h12.114V69.384l73.885 95.461a90.304 90.304 0 009.509-7.325z"/><path fill="url(#c)" d="M115 54h12v72h-12z"/></g><defs><linearGradient id="b" x1="109" x2="144.5" y1="116.5" y2="160.5" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="c" x1="121" x2="120.799" y1="54" y2="106.875" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs></svg>
        <span style="font-size: 14px; font-weight: 500; color: #333;">Next.js</span>
    </a>
    <a href="https://github.com/HeyPuter/angular" target="_blank" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; border: 1px solid #e2e4ef; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; background: #fff;">
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px; margin-bottom: 12px;" viewBox="0 0 640 640"><path fill="#dd0031" d="M281.7 332.1L357.9 332.1L319.8 240.5L281.7 332.1zM319.8 96L112 170.4L143.8 446.1L319.8 544L495.8 446.1L527.6 170.4L319.8 96zM450 437.8L401.4 437.8L375.2 372.4L264.6 372.4L238.4 437.8L189.7 437.8L319.8 145.5L450 437.8z"/></svg>
        <span style="font-size: 14px; font-weight: 500; color: #333;">Angular</span>
    </a>
    <a href="https://github.com/HeyPuter/vue.js" target="_blank" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; border: 1px solid #e2e4ef; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; background: #fff;">
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px; margin-bottom: 12px;" viewBox="0 0 261.76 226.69"><path fill="#41b883" d="M161.096.001l-30.224 52.35L100.647.002H-.005L130.872 226.69 261.749 0z"/><path fill="#34495e" d="M161.096.001l-30.224 52.35L100.647.002H52.346l78.526 136.01L209.398.001z"/></svg>
        <span style="font-size: 14px; font-weight: 500; color: #333;">Vue.js</span>
    </a>
    <a href="https://github.com/HeyPuter/svelte" target="_blank" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; border: 1px solid #e2e4ef; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; background: #fff;">
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px; margin-bottom: 12px;" viewBox="0 0 98.1 118"><path fill="#ff3e00" d="M91.8 15.6C80.9-.1 59.2-4.7 43.6 5.2L16.1 22.8C8.6 27.5 3.4 35.2 1.9 43.9c-1.3 7.3-.2 14.8 3.3 21.3-2.4 3.6-4 7.6-4.7 11.8-1.6 8.9.5 18.1 5.7 25.4 11 15.7 32.6 20.3 48.2 10.4l27.5-17.5c7.5-4.8 12.7-12.5 14.2-21.1 1.3-7.3.2-14.8-3.3-21.3 2.4-3.6 4-7.6 4.7-11.8 1.7-9-.4-18.2-5.7-25.5"/><path fill="#fff" d="M40.9 103.9c-8.9 2.3-18.2-1.2-23.4-8.7-3.2-4.4-4.4-9.9-3.5-15.3.2-.9.4-1.7.6-2.6l.5-1.6 1.4 1c3.3 2.4 6.9 4.2 10.8 5.4l1 .3-.1 1c-.1 1.4.3 2.9 1.1 4.1 1.6 2.3 4.4 3.4 7.1 2.7.6-.2 1.2-.4 1.7-.7l27.4-17.4c1.4-.9 2.3-2.2 2.6-3.8.3-1.6-.1-3.3-1-4.6-1.6-2.3-4.4-3.3-7.1-2.6-.6.2-1.2.4-1.7.7l-10.5 6.7c-1.7 1.1-3.6 1.9-5.6 2.4-8.9 2.3-18.2-1.2-23.4-8.7-3.1-4.4-4.4-9.9-3.4-15.3.9-5.2 4.1-9.9 8.6-12.7l27.5-17.5c1.7-1.1 3.6-1.9 5.6-2.5 8.9-2.3 18.2 1.2 23.4 8.7 3.2 4.4 4.4 9.9 3.5 15.3-.2.9-.4 1.7-.7 2.6l-.5 1.6-1.4-1c-3.3-2.4-6.9-4.2-10.8-5.4l-1-.3.1-1c.1-1.4-.3-2.9-1.1-4.1-1.6-2.3-4.4-3.3-7.1-2.6-.6.2-1.2.4-1.7.7L32.4 46.1c-1.4.9-2.3 2.2-2.6 3.8s.1 3.3 1 4.6c1.6 2.3 4.4 3.3 7.1 2.6.6-.2 1.2-.4 1.7-.7l10.5-6.7c1.7-1.1 3.6-1.9 5.6-2.5 8.9-2.3 18.2 1.2 23.4 8.7 3.2 4.4 4.4 9.9 3.5 15.3-.9 5.2-4.1 9.9-8.6 12.7l-27.5 17.5c-1.7 1.1-3.6 1.9-5.6 2.5"/></svg>
        <span style="font-size: 14px; font-weight: 500; color: #333;">Svelte</span>
    </a>
    <a href="https://github.com/HeyPuter/astro" target="_blank" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; border: 1px solid #e2e4ef; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; background: #fff;">
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px; margin-bottom: 12px;" viewBox="0 0 128 128"><path fill="#ff5d01" d="M81.504 9.465c.973 1.207 1.469 2.836 2.457 6.09l21.656 71.136a90.079 90.079 0 0 0-25.89-8.765L65.629 30.28a1.833 1.833 0 0 0-3.52.004L48.18 77.902a90.104 90.104 0 0 0-26.003 8.778l21.758-71.14c.996-3.25 1.492-4.876 2.464-6.083a8.023 8.023 0 0 1 3.243-2.398c1.433-.575 3.136-.575 6.535-.575H71.72c3.402 0 5.105 0 6.543.579a7.988 7.988 0 0 1 3.242 2.402z"/><path fill="#ff5d01" d="M84.094 90.074c-3.57 3.054-10.696 5.136-18.903 5.136-10.07 0-18.515-3.137-20.754-7.356-.8 2.418-.98 5.184-.98 6.954 0 0-.527 8.675 5.508 14.71a5.671 5.671 0 0 1 5.672-5.671c5.37 0 5.367 4.683 5.363 8.488v.336c0 5.773 3.527 10.719 8.543 12.805a11.62 11.62 0 0 1-1.172-5.098c0-5.508 3.23-7.555 6.988-9.938 2.989-1.894 6.309-4 8.594-8.222a15.513 15.513 0 0 0 1.875-7.41 15.55 15.55 0 0 0-.734-4.735z"/></svg>
        <span style="font-size: 14px; font-weight: 500; color: #333;">Astro</span>
    </a>
    <a href="https://github.com/HeyPuter/vanilla.js" target="_blank" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; border: 1px solid #e2e4ef; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; background: #fff;">
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px; margin-bottom: 12px;" viewBox="0 0 630 630"><rect width="630" height="630" fill="#f7df1e"/><path d="M423.2 492.19c12.69 20.72 29.2 35.95 58.4 35.95 24.53 0 40.2-12.26 40.2-29.2 0-20.3-16.1-27.49-43.1-39.3l-14.8-6.35c-42.72-18.2-71.1-41-71.1-89.2 0-44.4 33.83-78.2 86.7-78.2 37.64 0 64.7 13.1 84.2 47.4l-46.1 29.6c-10.15-18.2-21.1-25.37-38.1-25.37-17.34 0-28.33 11-28.33 25.37 0 17.76 11 24.95 36.4 35.95l14.8 6.34c50.3 21.57 78.7 43.56 78.7 93 0 53.3-41.87 82.5-98.1 82.5-54.98 0-90.5-26.2-107.88-60.54zm-209.13 5.13c9.3 16.5 17.76 30.45 38.1 30.45 19.45 0 31.72-7.61 31.72-37.2v-201.3h59.2v202.1c0 61.3-35.94 89.2-88.4 89.2-47.4 0-74.85-24.53-88.81-54.08z"/></svg>
        <span style="font-size: 14px; font-weight: 500; color: #333;">Vanilla JavaScript</span>
    </a>
    <a href="https://github.com/HeyPuter/node.js-express.js" target="_blank" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; border: 1px solid #e2e4ef; border-radius: 12px; text-decoration: none; transition: all 0.2s ease; background: #fff;">
        <svg xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px; margin-bottom: 12px;" viewBox="0 0 448 512"><path fill="#689f63" d="M224 508c-6.7 0-13.5-1.8-19.4-5.2l-61.7-36.5c-9.2-5.2-4.7-7-1.7-8 12.3-4.3 14.8-5.2 27.9-12.7 1.4-.8 3.2-.5 4.6.4l47.4 28.1c1.7 1 4.1 1 5.7 0l184.7-106.6c1.7-1 2.8-3 2.8-5V149.3c0-2.1-1.1-4-2.9-5.1L226.8 37.7c-1.7-1-4-1-5.7 0L36.6 144.3c-1.8 1-2.9 3-2.9 5.1v213.1c0 2 1.1 4 2.9 4.9l50.6 29.2c27.5 13.7 44.3-2.4 44.3-18.7V167.5c0-3 2.4-5.3 5.4-5.3h23.4c2.9 0 5.4 2.3 5.4 5.3V378c0 36.6-20 57.6-54.7 57.6-10.7 0-19.1 0-42.5-11.6l-48.4-27.9C8.1 389.2.7 376.3.7 362.4V149.3c0-13.8 7.4-26.8 19.4-33.7L204.6 9c11.7-6.6 27.2-6.6 38.8 0l184.7 106.7c12 6.9 19.4 19.8 19.4 33.7v213.1c0 13.8-7.4 26.7-19.4 33.7L243.4 502.8c-5.9 3.4-12.6 5.2-19.4 5.2zm149.1-210.1c0-39.9-27-50.5-83.7-58-57.4-7.6-63.2-11.5-63.2-24.9 0-11.1 4.9-25.9 47.4-25.9 37.9 0 51.9 8.2 57.7 33.8.5 2.4 2.7 4.2 5.2 4.2h24c1.5 0 2.9-.6 3.9-1.7s1.5-2.6 1.4-4.1c-3.7-44.1-33-64.6-92.2-64.6-52.7 0-84.1 22.2-84.1 59.5 0 40.4 31.3 51.6 81.8 56.6 60.5 5.9 65.2 14.8 65.2 26.7 0 20.6-16.6 29.4-55.5 29.4-48.9 0-59.6-12.3-63.2-36.6-.4-2.6-2.6-4.5-5.3-4.5h-23.9c-3 0-5.3 2.4-5.3 5.3 0 31.1 16.9 68.2 97.8 68.2 58.4-.1 92-23.2 92-63.4z"/></svg>
        <span style="font-size: 14px; font-weight: 500; color: #333;">Node.js + Express</span>
    </a>
</div>

<style>
    .docs-content a[href*="github.com/HeyPuter"]:hover {
        border-color: #2563eb !important;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
        transform: translateY(-2px);
    }
</style>

<br>
<br>

## Where to Go From Here

To learn more about the capabilities of Puter.js and how to use them in your web application, check out

- [Tutorials](https://developer.puter.com/tutorials): Step-by-step guides to help you get started with Puter.js and build powerful applications.

- [Playground](https://docs.puter.com/playground): Experiment with Puter.js in your browser and see the results in real-time. Many examples are available to help you understand how to use Puter.js effectively.

- [Examples](https://docs.puter.com/examples): A collection of code snippets and full applications that demonstrate how to use Puter.js to solve common problems and build innovative applications.
