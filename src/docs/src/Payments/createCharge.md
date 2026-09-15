---
title: puter.payments.createCharge()
description: Create a Lightning charge that pays into the developer's wallet.
platforms: [websites, apps, nodejs, workers]
---

Creates a charge: a Lightning invoice for `amountSats` that pays into the developer's linked `breez.tips` address. Use it when you want to render the invoice yourself; [`checkout()`](/Payments/checkout/) does the same and shows a window.

## Syntax

```js
puter.payments.createCharge(options)
```

## Parameters

#### `options.amountSats` (Number) (required)

The amount in satoshis. A positive integer.

#### `options.description` (String) (optional)

Text shown to the payer in their wallet, at most 255 characters.

#### `options.lightningAddress` (String) (optional)

A `breez.tips` address to pay into instead of the address configured in the Dev Center. Only `breez.tips` addresses are accepted, and only from your own context: a worker, a script using your API token, or your own session. A charge created from inside an app always pays the app owner's configured address, so a payer holding the app's token cannot redirect it. Rejected with `lightning_address_override_forbidden` otherwise.

#### `options.metadata` (Object) (optional)

Any JSON object to attach to the charge, at most 4 KB. It comes back on every read.

## Return value

A `Promise` that resolves to a charge object:

- `id` (String): the charge's identifier.
- `status` (String): `pending`, `completed` or `expired`.
- `amountSats` (Number): the amount in satoshis.
- `description` (String | null)
- `metadata` (Object | null)
- `lightningAddress` (String): the address the charge pays into.
- `invoice` (String): the BOLT11 invoice to pay.
- `cashAppUrl` (String): a `cash.app` link that opens the invoice in Cash App.
- `appUid` (String | null): the app that created the charge.
- `createdAt`, `expiresAt` (String): ISO 8601 timestamps. Invoices are payable for 5 minutes. A charge past `expiresAt` reads as `expired`, but a payment that was already in flight can still land for up to 10 minutes after that, in which case the charge flips to `completed`.
- `paidAt` (String | null): when the payment settled.

Rejects with:

- `invalid_amount`, `invalid_description`, `invalid_metadata`: the option failed validation.
- `invalid_lightning_address`: not a `breez.tips` address.
- `lightning_address_override_forbidden`: `lightningAddress` was passed from an app.
- `lightning_address_not_configured`: the developer has not linked a Glow wallet yet. The error carries `glowSetupUrl`.
- `lightning_address_not_found`: the address does not exist on `breez.tips`.
- `amount_out_of_range`: outside what the address accepts.
- `lightning_verify_unsupported`, `lightning_service_unavailable`: `breez.tips` could not issue a verifiable invoice right now.
- `too_many_requests`: more than 30 charges per minute from one account.

<div class="info"><strong>Verify before you deliver.</strong> A charge created in the browser is created by the payer's session, so its <code>amountSats</code>, <code>description</code> and <code>metadata</code> are whatever that client sent. Before handing over anything valuable, read the charge from code the payer cannot tamper with (a <a href="/Workers/">worker</a> or your own server) with <a href="/Payments/getCharge/">getCharge()</a>, and check <code>status</code>, <code>amountSats</code> and <code>lightningAddress</code> against what you expected.</div>

## Examples

<strong class="example-title">Create a charge and show the invoice</strong>

```html;payments-create-charge-example
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const charge = await puter.payments.createCharge({
                amountSats: 500,
                description: 'Tip jar',
            });
            puter.print(`<textarea cols="60" rows="6">${charge.invoice}</textarea>`);
        })();
    </script>
</body>
</html>
```
