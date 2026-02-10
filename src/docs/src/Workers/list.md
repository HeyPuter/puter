---
title: puter.workers.list()
description: List all workers in your account.
platforms: [websites, apps, nodejs, workers]
---

Lists all workers in your account with their details.

## Syntax

```js
puter.workers.list()
```

## Parameters

None.

## Return Value

A `Promise` that resolves to a [`WorkerInfo`](/Objects/workerinfo) array with each worker's information.

## Examples

<strong class="example-title">List all workers</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // List all workers
            const workers = await puter.workers.list();
            puter.print(`You have ${workers.length} worker(s):<br>`);
            workers.forEach(worker => {
                puter.print(`- ${worker.name} (${worker.url})<br>`);
            });
        })();
    </script>
</body>
</html>
```
