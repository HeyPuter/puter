---
title: puter.payments.listCharges()
description: List the charges paying into your wallet, newest first.
platforms: [nodejs, workers]
---

Lists the charges created for the caller as a developer, across all their apps, newest first. Pending charges are refreshed against the Lightning network as they are listed.

This is a developer surface: call it from your own session, a script using your API token, or a worker. Apps cannot list a developer's charges.

## Syntax

```js
puter.payments.listCharges()
puter.payments.listCharges(options)
```

## Parameters

#### `options.limit` (Number) (optional)

Maximum charges per page, from 1 to 200. Defaults to 50.

#### `options.cursor` (String) (optional)

The `cursor` from the previous page.

#### `options.includeTotal` (Boolean) (optional)

Adds `total` to the page.

## Return value

A `Promise` that resolves to a page:

- `items` (Array): charge objects as described in [`createCharge()`](/Payments/createCharge/#return-value).
- `cursor` (String): present while more pages exist.
- `total` (Number): present when `includeTotal` was set.

## Examples

<strong class="example-title">Print the ten most recent charges</strong>

```html;payments-list-example
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const page = await puter.payments.listCharges({ limit: 10 });
            for (const charge of page.items) {
                puter.print(`${charge.createdAt} ${charge.amountSats} sats ${charge.status}<br>`);
            }
        })();
    </script>
</body>
</html>
```
