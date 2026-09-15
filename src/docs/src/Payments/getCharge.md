---
title: puter.payments.getCharge()
description: Read a charge and its current payment status.
platforms: [websites, apps, nodejs, workers]
---

Returns a charge. While a charge is pending, every read checks with the Lightning network whether the invoice has been paid, so the status is always current.

## Syntax

```js
puter.payments.getCharge(chargeId)
```

## Parameters

#### `chargeId` (String) (required)

The charge's `id`.

## Return value

A `Promise` that resolves to the charge object described in [`createCharge()`](/Payments/createCharge/#return-value). Rejects with `charge_not_found` when there is no such charge or the caller may not read it: only the developer it pays and the user who created it can.

`expired` is not final right away: a payment in flight when the invoice expired can still settle for up to 10 minutes, and reading the charge in that window picks it up as `completed`.

## Examples

<strong class="example-title">Check whether a charge was paid</strong>

```html;payments-get-charge-example
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const charge = await puter.payments.createCharge({ amountSats: 100 });
            const latest = await puter.payments.getCharge(charge.id);
            puter.print(`Charge ${latest.id} is ${latest.status}`);
        })();
    </script>
</body>
</html>
```
