---
title: puter.auth.getDetailedAppUsage()
description: Get detailed usage statistics for an application the user has accessed.
platforms: [websites, apps, nodejs, workers]
---

Get detailed usage statistics for an application.

<div class="info">

Users can only see the usage of applications they have accessed before.
Usage data is scoped to the calling app only.

</div>

## Syntax

```js
puter.auth.getDetailedAppUsage(appId)
```

## Parameters

#### `appId` (String) (required)

The id of the application.

## Return value

A `Promise` that resolves to a [`DetailedAppUsage`](/Objects/detailedappusage) object containing resource usage statistics for the given application.

## Example

```html
<html>
  <body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
      puter.auth.getDetailedAppUsage(appId).then(function (result) {
        puter.print(`<pre>${JSON.stringify(result, null, 2)}</pre>`);
      });
    </script>
  </body>
</html>
```
