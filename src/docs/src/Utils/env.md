---
title: puter.env
description: Returns the environment in which Puter.js is being used.
platforms: [websites, apps, nodejs, workers]
---

A property of the `puter` object that returns the environment in which Puter.js is being used.

## Syntax

```js
puter.env
```

## Return value

A string containing the environment in which Puter.js is being used:

- `app` - Puter.js is running inside a Puter application. e.g. `https://puter.com/app/editor`

- `web` - Puter.js is running inside a web page outside of the Puter environment. e.g. `https://example.com/index.html`

- `gui` - Puter.js is running inside the Puter GUI. e.g. `https://puter.com/`

- `nodejs` - Puter.js is running in Node.js.

- `web-worker` - Puter.js is running inside a [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API).

- `service-worker` - Puter.js is running inside a [Puter Worker](/Workers/). Serverless workers execute in a service worker global scope, which is what this value reports.

## Examples

<strong class="example-title">Get the environment in which Puter.js is running</strong>

<div style="position: relative;">

```html
<html>
  <body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
      puter.print("Environment: " + puter.env);
    </script>
  </body>
</html>
```

</div>
