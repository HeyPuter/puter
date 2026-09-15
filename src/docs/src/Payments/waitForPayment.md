---
title: puter.payments.waitForPayment()
description: Wait until a charge is paid or expires.
platforms: [websites, apps, nodejs, workers]
---

Polls a charge until it is paid. Resolves with the completed charge, or rejects when the invoice expires.

## Syntax

```js
puter.payments.waitForPayment(chargeId)
puter.payments.waitForPayment(chargeId, options)
```

## Parameters

#### `chargeId` (String) (required)

The charge's `id`.

#### `options.intervalMs` (Number) (optional)

How often to check, in milliseconds. Defaults to `2000`.

#### `options.signal` (AbortSignal) (optional)

Aborts the wait. The promise then rejects with code `aborted`.

## Return value

A `Promise` that resolves to the completed charge. Rejects with `charge_expired` when the invoice ran out before it was paid (including the 10-minute late-settlement grace), or `aborted`. Both errors carry `chargeId`. Transient network errors are retried; `charge_not_found` and permission errors are passed through.

## Examples

<strong class="example-title">Unlock content once a charge is paid</strong>

```html;payments-wait-example
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const charge = await puter.payments.createCharge({ amountSats: 100, description: 'Article' });
            puter.print(`Pay ${charge.invoice} to continue...`);
            try {
                await puter.payments.waitForPayment(charge.id);
                puter.print('Thanks! Here is the article.');
            } catch (err) {
                puter.print(`Not paid: ${err.code}`);
            }
        })();
    </script>
</body>
</html>
```
