---
title: puter.payments.updateSettings()
description: Set the breez.tips address your charges pay into.
platforms: [nodejs, workers]
---

Sets the default `breez.tips` address that charges created by your apps pay into. The address is checked against `breez.tips` before it is saved. The Dev Center's Payments tab uses this call. Like the other developer surfaces, it works from your own session, a script using your API token, or a worker, not from an app.

## Syntax

```js
puter.payments.updateSettings({ lightningAddress })
```

## Parameters

#### `lightningAddress` (String | null) (required)

A `breez.tips` Lightning address, such as `you@breez.tips`, or `null` to clear it. Only `breez.tips` addresses are accepted.

## Return value

A `Promise` that resolves to the settings described in [`getSettings()`](/Payments/getSettings/#return-value). Rejects with `invalid_lightning_address` for any other domain, or `lightning_address_not_found` when the address does not exist.

## Examples

<strong class="example-title">Link a Glow wallet</strong>

```html;payments-update-settings-example
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const settings = await puter.payments.updateSettings({ lightningAddress: 'you@breez.tips' });
            puter.print(`Charges now pay into ${settings.lightningAddress}`);
        })();
    </script>
</body>
</html>
```
