# Embedded app browser

`GET /embed/apps` on the deployment's main GUI origin renders the same app browser
as the dashboard's Apps tab, without the desktop or dashboard navigation.

It supports search, paging, saved folders, and saved ordering. It uses the same
installed-app and recommendation data as the dashboard, including the user's
removed recommendations. Editing, adding, reordering, renaming, and uninstalling
are disabled. Selecting an app opens a new browser tab with no opener; the host
page stays open. Normal apps use `/app/<name>` on the GUI origin, and website
shortcuts use their external destination.

## Session and framing

Only show the iframe after the user has signed in. The embed reads the existing
GUI session from local storage on its own origin. It does not create accounts,
show a login dialog, or accept a token from its parent. A missing session or
failed load displays an unavailable/error state. Being signed in on a subdomain
alone does not populate the main GUI origin's storage; the main GUI session must
already exist.

The route's `Content-Security-Policy: frame-ancestors` allows the GUI origin and
the embedding page's origin when it is a subdomain of `config.domain` with the
scheme and port from `config.origin`, and not under one of the user-content
hosting domains (`static_hosting_domain`, `private_app_hosting_domain`, and their
`_alt` variants). For example, `https://puter.com` permits
`https://spreadsheet.puter.com`, and `http://puter.localhost:4100` permits
`http://spreadsheet.puter.localhost:4100` but not
`http://someone.site.puter.localhost:4100`. The embedding page is read from the
iframe request's referrer, so the host must not suppress it (the browser default
`strict-origin-when-cross-origin` is enough). All ancestors in a nested iframe
chain must be allowed. Other GUI routes retain `X-Frame-Options: SAMEORIGIN`.

The embed accepts no query parameters. Requests with a query string redirect to
the same embed path so SDK bootstrap parameters cannot override the session or API
origin. The host needs to allow the GUI origin in its own `frame-src` CSP if it
sets one. If sandboxing the iframe, allow scripts, same-origin storage, popups,
and popups to escape the sandbox.

## Host integration

Create the iframe when “More apps” is opened, and remove it on close so reopening
loads current apps and preferences. The host owns the modal and close control;
there is no parent messaging API and no app list or credential is sent to it.
The app browser fills its iframe and responds to its size.

This example assumes `puterOrigin` comes from the host app's deployment settings
and the caller has already established the GUI session. Translate the button and
frame labels using the host app's localization system.

```html
<button id="more-apps" type="button">More apps</button>
<dialog id="apps-dialog" aria-label="More apps">
  <button id="close-apps" type="button">Close</button>
  <div id="apps-frame"></div>
</dialog>
<style>
  #apps-dialog { padding: 12px; width: min(900px, 90vw); }
  #apps-frame iframe { width: 100%; height: min(650px, 75vh); border: 0; }
</style>
<script type="module">
  const puterOrigin = 'https://puter.com'; // Use this deployment's configured origin.
  const dialog = document.querySelector('#apps-dialog');
  const container = document.querySelector('#apps-frame');
  const trigger = document.querySelector('#more-apps');

  trigger.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.title = 'Your apps';
    frame.src = new URL('/embed/apps', puterOrigin).href;
    container.replaceChildren(frame);
    dialog.showModal();
  });
  document.querySelector('#close-apps').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    container.replaceChildren();
    trigger.focus();
  });
</script>
```

## Implementation and checks

`createAppBrowser` in `src/gui/src/UI/Dashboard/AppBrowser.js` owns the shared UI
and data behavior. `TabApps.js` injects desktop actions. `appsEmbed.js` supplies
new-tab launching and loads only the embed entry, its SDK, and shared styles.
The normal GUI webpack build emits `bundle.min.js` and `apps-embed.min.js`.
No puter.js API or app-list endpoint changes are needed.

Run the GUI component/browser tests (with the SDK bundle built and Playwright
Chromium installed), and the backend route tests:

```sh
npx vitest run --config src/gui/vitest.config.js src/gui/src/UI/Dashboard/AppBrowser
npx vitest run --config src/backend/vitest.config.ts src/backend/server.test.ts
```
