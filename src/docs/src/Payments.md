---
title: Payments
description: Accept Lightning payments in your app. Funds go straight to your own wallet.
---

The Payments API lets your app charge users in bitcoin over the Lightning Network. You link a [Glow](https://breez.technology/glow/) wallet once in the Dev Center, and every charge your app creates pays into that wallet directly. Puter never holds your funds and never sees your keys.

Payers can use any Lightning wallet, including Cash App. Your app gets a ready-made checkout window, or the raw charge if you want to build your own.

## Setup

1. Install [Glow](https://breez.technology/glow/) and pick your Lightning address. It looks like `you@breez.tips`.
2. Open the Dev Center, go to **Payments**, and enter that address.

That's it. Charges created by any of your apps now pay into your Glow wallet.

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="checkout"><span>Checkout</span></div>
    <div class="example-group" data-section="createCharge"><span>Create a charge</span></div>
    <div class="example-group" data-section="waitForPayment"><span>Wait for payment</span></div>
    <div class="example-group" data-section="listCharges"><span>List charges</span></div>
</div>

<div class="example-content" data-section="checkout" style="display:block;">

#### Show a checkout window and unlock a feature once it is paid

```html;payments-checkout
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
                });
                puter.print(`Paid $${charge.fiat.amount} (${charge.amountSats} sats). Charge ${charge.id} is ${charge.status}.`);
            } catch (err) {
                puter.print(`Not paid: ${err.code}`);
            }
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="createCharge">

#### Create a charge and render the invoice yourself

```html;payments-create-charge
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const charge = await puter.payments.createCharge({
                amountSats: 500,
                description: 'Tip jar',
            });
            puter.print(`<p>Pay this invoice:</p><textarea cols="60" rows="6">${charge.invoice}</textarea>`);
            puter.print(`<p><a href="${charge.cashAppUrl}" target="_blank">Pay with Cash App</a></p>`);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="waitForPayment">

#### Wait until a charge is paid

```html;payments-wait
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const charge = await puter.payments.createCharge({ amountSats: 100 });
            puter.print(`Waiting for ${charge.amountSats} sats...`);
            try {
                const paid = await puter.payments.waitForPayment(charge.id);
                puter.print(`Paid at ${paid.paidAt}`);
            } catch (err) {
                puter.print(`Not paid: ${err.code}`);
            }
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="listCharges">

#### List your charges as a developer

```html;payments-list
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

</div>

## Pricing in dollars or in sats

Every charge is settled in satoshis, but you can price it either way:

- `amountSats: 1000` fixes the number of satoshis.
- `amount: 4.99, currency: 'USD'` fixes the fiat price. The server converts it to satoshis at the current exchange rate when the charge is created, rounding up to the next satoshi, and records the conversion on the charge as `fiat: { amount, currency, rate }`. Any ISO 4217 currency with a published bitcoin price works, not just USD. The amount can have no more decimals than the currency does, so the price the payer sees is the price converted.

Once created, a charge is a fixed number of satoshis. The rate is not re-quoted while the payer decides; an invoice lives 5 minutes, so the exposure is small. If the rate source is unreachable, or the table it serves is stale, fiat-priced charges fail with `exchange_rate_unavailable` rather than being quoted at an old price; sats-priced charges are unaffected.

## How it works

- A charge is a Lightning invoice for a fixed number of satoshis, requested from the `breez.tips` address it pays into. Invoices stay payable for 5 minutes.
- Every read of a pending charge checks with the Lightning network whether the invoice has been paid, so status is always current.
- When an app creates a charge, it always pays the app owner's configured address. The user paying gets to read that charge; nobody else does.
- A charge past its expiry reads as `expired`, but a payment already in flight can still settle for up to 10 minutes after that, and the charge then flips to `completed`.

## Verifying payments

Everything an app passes to `createCharge()` or `checkout()` is chosen in the payer's browser, and so is the code that reacts to the resolved promise. Use the promise for the user interface, and decide what to deliver from code the payer cannot tamper with: a [worker](/Workers/) or your own server. There, read the charge with [`getCharge()`](/Payments/getCharge/) and check that `status` is `completed`, that `lightningAddress` is your own address, and that `amountSats` is at least what the item is worth. How the charge was priced is the payer's choice too, so do not branch on whether `fiat` is present; for a fiat price, compute the satoshis you expect from a rate you trust and compare with `amountSats`. [`createCharge()`](/Payments/createCharge/) spells out the check. Developer surfaces such as [`listCharges()`](/Payments/listCharges/) and the settings calls only work from your own context, never from an app.
- Only `breez.tips` addresses are accepted. Get one by installing [Glow](https://breez.technology/glow/).
