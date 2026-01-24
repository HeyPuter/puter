---
title: puter.auth.getMonthlyUsage()
description: Get the user's current monthly resource usage in the Puter ecosystem.
platforms: [websites, apps, nodejs, workers]
---

Get the user's current monthly resource usage in the Puter ecosystem.

<div class="info">

Usage data is scoped to the calling app only.

</div>

## Syntax

```js
puter.auth.getMonthlyUsage()
```

## Parameters

None

## Return value

A `Promise` that resolves to a [`MonthlyUsage`](/Objects/monthlyusage) object containing the user's monthly usage information.

## Example

```html;auth-get-monthly-usage
<html>
  <body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
      puter.auth.getMonthlyUsage().then(function (usage) {
        puter.print(`<pre>${JSON.stringify(usage, null, 2)}</pre>`);
      });
    </script>
  </body>
</html>

```
