---
title: puter.ui.setURLParams()
description: Sets the query string of the browser URL so your app's state is shareable and bookmarkable.
platforms: [apps]
---

Replaces the query string of the browser's address bar while your app owns the URL, turning your app's current state into a shareable, bookmarkable deep link. When your app is open full-tab on Puter the URL reads `puter.com/app/<your-app>`; this call makes it read `puter.com/app/<your-app>?<your-params>`.

Anyone who opens that link lands straight in your app, and every parameter you set is handed back to it — the same query string appears on your app's own window, so you can read it with `URLSearchParams` at startup and restore the state it describes.

Only the query string is yours: the path always names your app, so a link to your app can never be made to look like a link to another app or to Puter itself. The call also never adds history entries — the browser's Back button keeps working exactly as before.

## Syntax
```js
puter.ui.setURLParams(params)
puter.ui.setURLParams()
```

## Parameters

#### `params` (Object | String | URLSearchParams) (optional)
The parameters to show in the URL, replacing any parameters set before. Pass a plain object of key/value pairs (values may be strings, numbers, or booleans; `null` and `undefined` values are dropped), a query string like `'doc=readme&line=10'`, or a `URLSearchParams` instance. Values are percent-encoded for you.

Calling with no argument, or with `{}`, clears the query string back to the bare `/app/<your-app>` URL.

Each call replaces the whole query string — merge into your previous state yourself if you want to keep it.

**Reserved names.** Parameters prefixed `puter.` belong to Puter's app-launch protocol, and a set of names that Puter itself interprets when a page loads — including `auth_token`, `token`, `user`, `action`, `app`, `path`, `readURL`, `redirectURL`, `api_origin`, `c`, `embedded_in_popup`, and `error_from_within_iframe` — cannot be set; the promise rejects if you try. To stay clear of present and future reserved names, prefix your parameters with something of your own (for example `ed.doc` instead of `doc`). The limit is 32 parameters and 2,048 characters of serialized query string.

## Return value
A `Promise` that resolves to an object:

* On success: `{ applied: true, url: '...' }` — `url` is the full URL now shown in the address bar, ready for a "Copy link" feature.
* Otherwise: `{ applied: false, reason: '...' }`, where `reason` is one of:
    - `'desktop_mode'` — the user runs Puter as a desktop; there the URL never reflects apps.
    - `'not_url_owner'` — the address bar doesn't currently name your app: your window is minimized, or another app was opened on top of yours and now owns the URL. Ownership comes back when the user returns to your app.
    - `'superseded'` — you called again before this update was applied; the newer call won.
    - `'window_closed'`, `'browser_throttled'`, `'not_in_puter'` — the window is gone, the browser refused the write (its history rate limit), or the app isn't running inside Puter.
    - `'unsupported'` — this version of Puter doesn't implement `setURLParams()`.
    - `'unknown'` — unrecognized response; treat it like any other non-applied result.

Invalid parameters reject the promise with a `{ message, code }` error, where `code` is one of `param_reserved`, `params_invalid`, `value_invalid`, `params_too_many`, or `params_too_long`.

Treat `applied: false` as advisory, not as a failure: your app should work the same whether or not its state is mirrored in the URL.

## Examples

### Reflect app state in the URL, and restore it on launch

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // On launch, read the deep link back — the same params appear in
        // your app's own URL. openDocument re-asserts the state so the
        // address bar shows it again (Puter opens your app on a bare
        // /app/<name> URL until you ask).
        const params = new URLSearchParams(location.search);
        let currentDoc;
        openDocument(params.get('doc') ?? 'untitled');

        // Whenever the user switches documents, update the URL.
        function openDocument(name) {
            currentDoc = name;
            document.body.textContent = `Editing: ${name}`;
            puter.ui.setURLParams({ doc: name });
        }
    </script>
</body>
</html>
```

### A "Copy link" button

Use the returned `url` rather than reading `location.href` yourself — your app runs in an iframe, so its own location is not the link the user wants to share. When the URL isn't yours to set (see the reasons above), build the link from your app's name instead:

```js
async function copyShareLink() {
    const result = await puter.ui.setURLParams({ doc: currentDoc });
    const link = result.applied
        ? result.url
        : `https://puter.com/app/my-app?${new URLSearchParams({ doc: currentDoc })}`;
    await navigator.clipboard.writeText(link);
}
```

### Clearing the URL

```js
// Back to a bare /app/<your-app>
puter.ui.setURLParams();
```

## Behavior details

* **Minimize and restore.** While your app is minimized the address bar belongs to the dashboard again; when the user brings your app back, the parameters you last set *through this method* are re-applied automatically. Parameters that merely came in on a deep link are not — Puter clears them from the address bar once your app is running, so call `setURLParams()` at startup if you want them to persist (as the example above does).
* **Pacing.** Updates are applied at most every 500ms per app; rapid successive calls are coalesced and the last one wins (earlier ones resolve with `reason: 'superseded'`). Call it when state changes, not on every keystroke.
* **Nothing sensitive.** The URL is meant to be shared, screenshotted, and kept in browser history — never put tokens, personal data, or other secrets in it.
* **`posargs`.** Setting `posargs` to a JSON-encoded array additionally delivers those values as `puter.args.command_line.args` when the link is opened — the same convention as launching apps from a URL.
