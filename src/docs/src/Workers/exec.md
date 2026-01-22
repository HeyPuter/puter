---
title: puter.workers.exec()
description: Execute workers as an authenticated user.
platforms: [websites, apps, nodejs]
---

Sends a request to a worker endpoint while automatically passing the user's session.

<div class="info">
Unlike standard <code>fetch()</code>, <code>puter.workers.exec()</code> automatically includes the user's session. This provides the worker with the <strong>user context</strong> (<code>user.puter</code>), enabling the <a href="/user-pays-model/">User-Pays model</a>.
</div>

## Syntax

```js
puter.workers.exec(workerURL, options)
```

## Parameters

#### `workerURL` (String)(Required)

The URL of the worker to execute.

#### `options` (Object)

A standard [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit) object

## Return Value

A `Promise` that resolves to a `Response` object (similar to the Fetch API).

## Examples

<strong class="example-title">Execute a worker</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Execute a worker and get the response
            const response = await puter.workers.exec('https://my-worker.puter.work');
            const data = await response.text();
            puter.print(`Response: ${data}`);
        })();
    </script>
</body>
</html>
```
