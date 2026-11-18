---
title: puter.apps.get()
description: Retrieve details of your Puter app.
platforms: [websites, apps, nodejs, workers]
---

Returns an app with the given name or URL.

If the app does not exist, the promise will be rejected.

## Syntax

```js
puter.apps.get(name)
puter.apps.get(name, options)
puter.apps.get(url)
puter.apps.get(url, options)
```

## Parameters

#### `name` (required)

The name of the app to get.

#### `url` (required)

A URL on the app's website, such as `https://my-app.puter.site/about`. Puter.js treats any string that contains `://` as a URL. Only the URL's origin is matched, so this returns the same app that a page on that origin acts as when it calls Puter.js. See [Getting an app by URL](#getting-an-app-by-url).

#### `options` (Object) (optional)

An object containing the following properties:

| Option | Type | Description |
|--------|------|-------------|
| `icon_size` | `Number \| null` | An integer representing the size of the icons to return. Possible values are `null`, `16`, `32`, `64`, `128`, `256`, and `512`. Default is `null` (the original size). |
| `stats_period` | `String` | The period for which to get the user and open count. Possible values are `today`, `yesterday`, `7d`, `30d`, `this_month`, `last_month`, `this_year`, `last_year`, `month_to_date`, `year_to_date`, `last_12_months`. Default is `all` (all time). |

## Return value

A `Promise` that will resolve to the [`App`](/Objects/app/) object with the given name or URL.

## Errors

| Code | When |
|------|------|
| `not_found` | No app has this name, or no app runs at this URL's origin. |
| `bad_request` | The URL isn't an `http://`, `https://`, or browser extension URL. |
| `app_blocked` | The URL's origin is blocked from using Puter. |
| `forbidden` | The app is protected and you don't have access to it. |

## Getting an app by URL

A URL matches the app whose index URL is the root of that URL's origin. For example, `https://my-app.puter.site/about?tab=2` returns the app whose index URL is `https://my-app.puter.site/` or `https://my-app.puter.site/index.html`. An app whose index URL is below the root, such as `https://example.com/tools/`, isn't returned for a URL.

A website that isn't registered as an app gets an app the first time a user signs in to Puter from one of its pages, so you can get it by URL after that. The `name` and `title` of that app are both its `uid`.

## Examples

### Create a random app then get it

```html;app-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate a random app name to make sure it doesn't already exist
            let appName = puter.randName();

            // (2) Create the app
            await puter.apps.create(appName, "https://example.com");
            puter.print(`"${appName}" created<br>`);

            // (3) Retrieve the app using get()
            let app = await puter.apps.get(appName);
            puter.print(`"${appName}" retrieved using get(): id: ${app.uid}<br>`);

            // (4) Delete the app (cleanup)
            await puter.apps.delete(appName);
        })();
    </script>
</body>
</html>
```

### Get an app by its URL

```html;app-get-by-url
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create an app at the root of a random origin
            let appName = puter.randName();
            await puter.apps.create(appName, `https://${appName}.example.com/`);

            // (2) Get it with any URL on that origin
            let app = await puter.apps.get(`https://${appName}.example.com/about`);
            puter.print(`Found "${app.name}" by URL: id: ${app.uid}<br>`);

            // (3) Delete the app (cleanup)
            await puter.apps.delete(appName);
        })();
    </script>
</body>
</html>
```
