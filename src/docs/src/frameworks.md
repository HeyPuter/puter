---
title: Framework Integrations
description: Learn how to integrate Puter.js into various web frameworks.
---

Puter.js is designed to be framework-agnostic. This means you can use it with practically any web framework.

Simply install the Puter.js NPM library and use it in your app.

```bash
npm install @heyputer/puter.js
```

```javascript
import puter from "@heyputer/puter.js";

puter.ai.chat("hello world");
```

Here are examples for some popular frameworks:

<h2 id="react"><svg xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" viewBox="0 0 512 512"><circle cx="256" cy="256" r="36" fill="#61dafb"/><path fill="#61dafb" d="M256 144c-74.4 0-138.6 16.5-176.3 41.5C42.4 210.5 16 243.2 16 256s26.4 45.5 63.7 70.5C117.4 351.5 181.6 368 256 368s138.6-16.5 176.3-41.5c37.3-25 63.7-57.7 63.7-70.5s-26.4-45.5-63.7-70.5C394.6 160.5 330.4 144 256 144zm0 192c-44.2 0-80-35.8-80-80s35.8-80 80-80 80 35.8 80 80-35.8 80-80 80z" opacity="0"/><ellipse cx="256" cy="256" rx="220" ry="70" fill="none" stroke="#61dafb" stroke-width="16"/><ellipse cx="256" cy="256" rx="220" ry="70" fill="none" stroke="#61dafb" stroke-width="16" transform="rotate(60 256 256)"/><ellipse cx="256" cy="256" rx="220" ry="70" fill="none" stroke="#61dafb" stroke-width="16" transform="rotate(120 256 256)"/></svg>React</h2>

With React, import Puter.js and use it in your component.

```jsx
// MyComponent.jsx
import { useEffect } from "react";
import puter from "@heyputer/puter.js";

export function MyComponent() {
    ...
    useEffect(() => {
        puter.ai.chat("hello");
    }, [])
    ...
}
```

Check out our [React template](https://github.com/HeyPuter/react) for a complete example.

<h2 id="nextjs"><svg xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" viewBox="0 0 180 180"><mask id="a" width="180" height="180" x="0" y="0" maskUnits="userSpaceOnUse" style="mask-type:alpha"><circle cx="90" cy="90" r="90" fill="#000"/></mask><g mask="url(#a)"><circle cx="90" cy="90" r="90" fill="#000"/><path fill="url(#b)" d="M149.508 157.52L69.142 54H54v71.97h12.114V69.384l73.885 95.461a90.304 90.304 0 009.509-7.325z"/><path fill="url(#c)" d="M115 54h12v72h-12z"/></g><defs><linearGradient id="b" x1="109" x2="144.5" y1="116.5" y2="160.5" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="c" x1="121" x2="120.799" y1="54" y2="106.875" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs></svg>Next.js</h2>

With Next.js, add the `"use client"` directive at the top of your component file since Puter.js requires browser APIs.

```jsx
// MyComponent.jsx
"use client";

import { useEffect } from "react";
import puter from "@heyputer/puter.js";

export function MyComponent() {
    ...
    useEffect(() => {
        puter.ai.chat("hello");
    }, [])
    ...
}
```

Check out our [Next.js template](https://github.com/HeyPuter/next.js) for a complete example.

<div class="info">

For Next.js version 15 or earlier, you need to enable Turbopack for Puter.js to work. Version 16 and later have Turbopack enabled by default.
Learn how to enable Turbopack here: <https://nextjs.org/docs/15/app/api-reference/turbopack>

</div>

<h2 id="angular"><svg xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" viewBox="0 0 640 640"><path fill="#dd0031" d="M281.7 332.1L357.9 332.1L319.8 240.5L281.7 332.1zM319.8 96L112 170.4L143.8 446.1L319.8 544L495.8 446.1L527.6 170.4L319.8 96zM450 437.8L401.4 437.8L375.2 372.4L264.6 372.4L238.4 437.8L189.7 437.8L319.8 145.5L450 437.8z"/></svg>Angular</h2>

With Angular, import Puter.js and call it from your component methods.

```typescript
// my-component.component.ts
import { Component } from "@angular/core";
import puter from "@heyputer/puter.js";

@Component({
    selector: "app-my-component",
    template: `<button (click)="handleClick()">Chat</button>`,
})
export class MyComponent {
    handleClick() {
        puter.ai.chat("hello");
    }
}
```

Check out our [Angular template](https://github.com/HeyPuter/angular) for a complete example.

<h2 id="vue"><svg xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" viewBox="0 0 261.76 226.69"><path fill="#41b883" d="M161.096.001l-30.224 52.35L100.647.002H-.005L130.872 226.69 261.749 0z"/><path fill="#34495e" d="M161.096.001l-30.224 52.35L100.647.002H52.346l78.526 136.01L209.398.001z"/></svg>Vue.js</h2>

With Vue.js, import Puter.js and call it from your component functions.

```javascript
<!-- MyComponent.vue -->
<script setup>
import puter from "@heyputer/puter.js";

function handleClick() {
    puter.ai.chat("hello");
}
</script>

<template>
    <button @click="handleClick">Chat</button>
</template>
```

Check out our [Vue.js template](https://github.com/HeyPuter/vue.js) for a complete example.

<h2 id="svelte"><svg xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" viewBox="0 0 98.1 118"><path fill="#ff3e00" d="M91.8 15.6C80.9-.1 59.2-4.7 43.6 5.2L16.1 22.8C8.6 27.5 3.4 35.2 1.9 43.9c-1.3 7.3-.2 14.8 3.3 21.3-2.4 3.6-4 7.6-4.7 11.8-1.6 8.9.5 18.1 5.7 25.4 11 15.7 32.6 20.3 48.2 10.4l27.5-17.5c7.5-4.8 12.7-12.5 14.2-21.1 1.3-7.3.2-14.8-3.3-21.3 2.4-3.6 4-7.6 4.7-11.8 1.7-9-.4-18.2-5.7-25.5"/><path fill="#fff" d="M40.9 103.9c-8.9 2.3-18.2-1.2-23.4-8.7-3.2-4.4-4.4-9.9-3.5-15.3.2-.9.4-1.7.6-2.6l.5-1.6 1.4 1c3.3 2.4 6.9 4.2 10.8 5.4l1 .3-.1 1c-.1 1.4.3 2.9 1.1 4.1 1.6 2.3 4.4 3.4 7.1 2.7.6-.2 1.2-.4 1.7-.7l27.4-17.4c1.4-.9 2.3-2.2 2.6-3.8.3-1.6-.1-3.3-1-4.6-1.6-2.3-4.4-3.3-7.1-2.6-.6.2-1.2.4-1.7.7l-10.5 6.7c-1.7 1.1-3.6 1.9-5.6 2.4-8.9 2.3-18.2-1.2-23.4-8.7-3.1-4.4-4.4-9.9-3.4-15.3.9-5.2 4.1-9.9 8.6-12.7l27.5-17.5c1.7-1.1 3.6-1.9 5.6-2.5 8.9-2.3 18.2 1.2 23.4 8.7 3.2 4.4 4.4 9.9 3.5 15.3-.2.9-.4 1.7-.7 2.6l-.5 1.6-1.4-1c-3.3-2.4-6.9-4.2-10.8-5.4l-1-.3.1-1c.1-1.4-.3-2.9-1.1-4.1-1.6-2.3-4.4-3.3-7.1-2.6-.6.2-1.2.4-1.7.7L32.4 46.1c-1.4.9-2.3 2.2-2.6 3.8s.1 3.3 1 4.6c1.6 2.3 4.4 3.3 7.1 2.6.6-.2 1.2-.4 1.7-.7l10.5-6.7c1.7-1.1 3.6-1.9 5.6-2.5 8.9-2.3 18.2 1.2 23.4 8.7 3.2 4.4 4.4 9.9 3.5 15.3-.9 5.2-4.1 9.9-8.6 12.7l-27.5 17.5c-1.7 1.1-3.6 1.9-5.6 2.5"/></svg>Svelte</h2>

With Svelte, import Puter.js and call it from your component functions.

```typescript
<!-- MyComponent.svelte -->
<script>
import puter from "@heyputer/puter.js";

function handleClick() {
    puter.ai.chat("hello");
}
</script>

<button on:click={handleClick}>Chat</button>
```

Check out our [Svelte template](https://github.com/HeyPuter/svelte) for a complete example.

<h2 id="astro"><svg xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px; vertical-align: middle; margin-right: 8px;" viewBox="0 0 128 128"><path fill="#ff5d01" d="M81.504 9.465c.973 1.207 1.469 2.836 2.457 6.09l21.656 71.136a90.079 90.079 0 0 0-25.89-8.765L65.629 30.28a1.833 1.833 0 0 0-3.52.004L48.18 77.902a90.104 90.104 0 0 0-26.003 8.778l21.758-71.14c.996-3.25 1.492-4.876 2.464-6.083a8.023 8.023 0 0 1 3.243-2.398c1.433-.575 3.136-.575 6.535-.575H71.72c3.402 0 5.105 0 6.543.579a7.988 7.988 0 0 1 3.242 2.402z"/><path fill="#ff5d01" d="M84.094 90.074c-3.57 3.054-10.696 5.136-18.903 5.136-10.07 0-18.515-3.137-20.754-7.356-.8 2.418-.98 5.184-.98 6.954 0 0-.527 8.675 5.508 14.71a5.671 5.671 0 0 1 5.672-5.671c5.37 0 5.367 4.683 5.363 8.488v.336c0 5.773 3.527 10.719 8.543 12.805a11.62 11.62 0 0 1-1.172-5.098c0-5.508 3.23-7.555 6.988-9.938 2.989-1.894 6.309-4 8.594-8.222a15.513 15.513 0 0 0 1.875-7.41 15.55 15.55 0 0 0-.734-4.735z"/></svg>Astro</h2>

With Astro, import Puter.js in any client-side script tag.

```html
<!-- Page.astro -->
...
<script>
    import puter from "@heyputer/puter.js";
    puter.ai.chat("hello");
</script>
...
```

Check out our [Astro template](https://github.com/HeyPuter/astro) for a complete example.

## Other Frameworks

For other frameworks, the approach is similar: install the package and import it where needed. Puter.js works in any environment that supports ES modules.
