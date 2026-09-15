---
title: puter.payments.createCharge()
description: Create a Lightning charge that pays into the developer's wallet.
platforms: [websites, apps, nodejs, workers]
---

Creates a charge: a Lightning invoice that pays into the developer's linked `breez.tips` address. Price it in satoshis with `amountSats`, or in a fiat currency with `amount` and `currency`; a fiat price is converted to satoshis at the current exchange rate when the charge is created. Use it when you want to render the invoice yourself; [`checkout()`](/Payments/checkout/) does the same and shows a window.

## Syntax

```js
puter.payments.createCharge(options)
```

## Parameters

Pass exactly one of `amountSats` or the `amount` + `currency` pair.

#### `options.amountSats` (Number)

The amount in satoshis. A positive integer.

#### `options.amount` (Number)

The price in `currency`. A positive number, such as `4.99`. It is converted to satoshis at the current rate when the charge is created and rounded up to the next satoshi, so you never receive less than the price you set. The invoice is fixed in satoshis from then on; the fiat value is not re-quoted if the rate moves while the payer is deciding.

#### `options.currency` (String)

The ISO 4217 code of `amount`, such as `USD`, `EUR` or `GBP`. Case-insensitive. Required with `amount`.

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
- `amountSats` (Number): the amount in satoshis. For a fiat-priced charge, the converted amount the invoice was issued for.
- `fiat` (Object | null): how the charge was priced when it was created in a fiat currency, or `null` for a charge priced in satoshis. Has `amount` (Number), `currency` (String, uppercase) and `rate` (Number), the price of 1 BTC in `currency` used for the conversion.
- `description` (String | null)
- `metadata` (Object | null)
- `lightningAddress` (String): the address the charge pays into.
- `invoice` (String): the BOLT11 invoice to pay.
- `cashAppUrl` (String): a `cash.app` link that opens the invoice in Cash App.
- `appUid` (String | null): the app that created the charge.
- `createdAt`, `expiresAt` (String): ISO 8601 timestamps. Invoices are payable for 5 minutes. A charge past `expiresAt` reads as `expired`, but a payment that was already in flight can still land for up to 10 minutes after that, in which case the charge flips to `completed`.
- `paidAt` (String | null): when the payment settled.

Rejects with:

- `invalid_amount`, `invalid_description`, `invalid_metadata`: the option failed validation. `invalid_amount` is also raised when both `amountSats` and `amount` are passed, or neither.
- `invalid_currency`: `currency` is not a three-letter code, or no exchange rate is published for it.
- `exchange_rate_unavailable`: the rate source could not be reached, so a fiat price cannot be converted right now. Charges priced in `amountSats` are unaffected.
- `invalid_lightning_address`: not a `breez.tips` address.
- `lightning_address_override_forbidden`: `lightningAddress` was passed from an app.
- `lightning_address_not_configured`: the developer has not linked a Glow wallet yet. The error carries `glowSetupUrl`.
- `lightning_address_not_found`: the address does not exist on `breez.tips`.
- `amount_out_of_range`: outside what the address accepts.
- `lightning_verify_unsupported`, `lightning_service_unavailable`: `breez.tips` could not issue a verifiable invoice right now.
- `too_many_requests`: more than 30 charges per minute from one account.

<div class="info"><strong>Verify before you deliver.</strong> A charge created in the browser is created by the payer's session, so its <code>amountSats</code>, <code>description</code> and <code>metadata</code> are whatever that client sent. Before handing over anything valuable, read the charge from code the payer cannot tamper with (a <a href="/Workers/">worker</a> or your own server) with <a href="/Payments/getCharge/">getCharge()</a>, and check <code>status</code>, <code>lightningAddress</code> and the price against what you expected: <code>amountSats</code> for a sats-priced charge, or <code>fiat.amount</code> and <code>fiat.currency</code> for a fiat-priced one.</div>

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

<strong class="example-title">Price a charge in US dollars</strong>

```html;payments-create-charge-fiat-example
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const charge = await puter.payments.createCharge({
                amount: 4.99,
                currency: 'USD',
                description: 'Monthly plan',
            });
            puter.print(`$${charge.fiat.amount} is ${charge.amountSats} sats at $${charge.fiat.rate} per BTC`);
        })();
    </script>
</body>
</html>
```
