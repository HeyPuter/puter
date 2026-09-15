---
title: puter.payments.getSettings()
description: Read your developer payment settings.
platforms: [nodejs, workers]
---

Returns the caller's payment settings as a developer: the `breez.tips` address charges pay into by default.

This is a developer surface: call it from your own session, a script using your API token, or a worker. Apps cannot read a developer's settings.

## Syntax

```js
puter.payments.getSettings()
```

## Return value

A `Promise` that resolves to:

- `lightningAddress` (String | null): the configured address, or `null` when none is set.
- `glowSetupUrl` (String): where to get a Glow wallet and a `breez.tips` address.

## Examples

<strong class="example-title">Check whether payments are set up</strong>

```html;payments-get-settings-example
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const settings = await puter.payments.getSettings();
            if (settings.lightningAddress) {
                puter.print(`Charges pay into ${settings.lightningAddress}`);
            } else {
                puter.print(`<a href="${settings.glowSetupUrl}" target="_blank">Get Glow</a> to accept payments.`);
            }
        })();
    </script>
</body>
</html>
```
