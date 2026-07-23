---
title: puter.workers.list()
description: List all workers in your account.
platforms: [websites, apps, nodejs, workers]
---

Lists all workers in your account with their details.

## Syntax

```js
puter.workers.list()
puter.workers.list(options)
```

## Parameters

#### `options` (Object) (optional)

An object with the following optional properties:

- `limit` (Number): Maximum number of workers to return in a single call.
- `offset` (Number): Skips the given number of workers. Prefer `cursor` for paging through large lists.
- `cursor` (String | null): Opts into paginated results. Pass `null` for the first page, then the `cursor` from each page to fetch the next one.
- `includeTotal` (Boolean): If `true`, the paginated result includes a `total` count.
- `stream` (Boolean): If `true`, the method returns an async iterator of page objects instead of a promise, for use with `for await ... of`. Combine with `limit` to control the page size, or `cursor` to resume from a previous page. Cannot be combined with `offset`. With `includeTotal`, only the first page carries `total`.

## Return Value

A `Promise` that resolves to a [`WorkerInfo`](/Objects/workerinfo) array with each worker's information.

When the request includes any pagination option, the promise instead resolves to a page object:

- `items` (Array): The [`WorkerInfo`](/Objects/workerinfo) objects on this page.
- `cursor` (String) (optional): Present while more pages exist; pass it to the next call.
- `total` (Number) (optional): Present when `includeTotal` was set.

Requests without pagination params keep returning the full list as a plain array, so existing code is unaffected — under the hood the SDK now fetches it page by page.

With `stream: true`, the method returns an async iterator of page objects instead:

```js
for await (const page of puter.workers.list({ stream: true })) {
    for (const worker of page.items) {
        console.log(worker.name);
    }
}
```

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
