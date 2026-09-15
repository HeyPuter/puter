---
title: puter.payments.checkout()
description: Show a checkout window for a Lightning charge and resolve once it is paid.
platforms: [websites, apps]
---

Creates a charge and shows a checkout window with a QR code, an **Open in wallet** link, a **Pay with Cash App** button, and a copyable invoice. The promise resolves with the completed charge once the payment settles. Browser environments only.

A charge priced with `amount` and `currency` shows the fiat price as the headline, with the satoshis it converted to underneath. A charge priced with `amountSats` shows satoshis only.

## Syntax

```js
puter.payments.checkout(options)
```

## Parameters

#### `options` (Object) (required)

Everything [`createCharge()`](/Payments/createCharge/) accepts, plus:

#### `options.title` (String) (optional)

The window's heading. Defaults to `Pay with bitcoin`.

## Return value

A `Promise` that resolves to the completed [charge](/Payments/getCharge/#return-value). It rejects with:

- `unsupported_environment` outside a browser (Node.js, workers). No charge is created.
- `checkout_cancelled` when the payer closes the window. The error carries `chargeId`. Cancelling only closes the window: a payer who already scanned the invoice can still pay it, so keep the id if you need to reconcile.
- `charge_expired` when the invoice runs out before it is paid. The error carries `chargeId`.
- Anything [`createCharge()`](/Payments/createCharge/#return-value) rejects with, such as `lightning_address_not_configured`.

<div class="info"><strong>Verify before you deliver.</strong> The window runs in the payer's browser, so the resolved promise is a convenience for the UI, not proof, and so is the charge's pricing: a payer can create a sats-priced charge instead of the fiat one your app asked for. Before handing over anything valuable, read the charge from a <a href="/Workers/">worker</a> or your own server with <a href="/Payments/getCharge/">getCharge()</a> and check <code>status</code>, <code>lightningAddress</code> and that <code>amountSats</code> is at least what your item is worth. See <a href="/Payments/createCharge/">createCharge()</a> for the fiat arithmetic.</div>

## Examples

<strong class="example-title">Charge $4.99 for an upgrade</strong>

```html;payments-checkout-example
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            try {
                const charge = await puter.payments.checkout({
                    amount: 4.99,
                    currency: 'USD',
                    description: 'Pro upgrade',
                    metadata: { plan: 'pro' },
                });
                puter.print(`Paid. Charge ${charge.id} completed at ${charge.paidAt}.`);
            } catch (err) {
                puter.print(`Not paid: ${err.code}`);
            }
        })();
    </script>
</body>
</html>
```
