---
title: puter.workers.get()
description: Get information about a specific worker.
platforms: [websites, apps, nodejs, workers]
---

Gets the information for a specific worker.

## Syntax

```js
puter.workers.get(workerName)
```

## Parameters

#### `workerName` (String)(Required)

The name of the worker to get the information for.

## Return Value

A `Promise` that resolves to a [`WorkerInfo`](/Objects/workerinfo) object if the worker exists, or `undefined` otherwise.

## Examples

<strong class="example-title">Basic Usage</strong>

```html;workers-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Get a worker's information
            const workerInfo = await puter.workers.get('my-api');
            if (workerInfo) {
                puter.print(`Worker information: ${JSON.stringify(workerInfo, null, 2)}`);
            } else {
                puter.print('Worker not found!');
            }
        })();
    </script>
</body>
</html>
```
