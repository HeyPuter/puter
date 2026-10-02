# Embedded Puter toolbar

`GET /embed/toolbar` renders a compact Puter toolbar: Upgrade for free accounts,
an Apps menu, and an account menu. It uses Puter's dashboard colors and follows
the browser's light/dark preference. Subscribers and paid organization seats do
not see Upgrade.

Add the iframe and the small host helper to a page on a deployment subdomain:

```html
<iframe
  data-puter-toolbar
  src="https://puter.com/embed/toolbar"
  title="Puter"
  style="width:244px;height:48px;border:0;vertical-align:middle"
></iframe>
<script defer src="https://puter.com/dist/toolbar-host.min.js"></script>
```

Replace both origins with the deployment's configured GUI origin. Show this only
after establishing a session on that origin. Translate the frame title in the
host application. Put the iframe in the app's header, outside transformed or
clipped containers. The helper also attaches to dynamically inserted frames.
It reserves the toolbar's original space while expanding the iframe over the
page, clamps menus to the viewport, and closes on outside click or Escape.
Without the helper, provide enough iframe space for the whole menu yourself.

Apps preserve search, saved folders, and saved order. Editing/removal is disabled.
Apps, account settings, adding another account, and Upgrade open in new tabs with
no opener. Upgrade opens the dashboard Usage tab and automatically opens the
billing UI when that deployment supplies it; self-hosted deployments without a
billing extension stay on Usage.

The account menu shows the current account and locally saved accounts. Switching
validates the selected session and synchronizes its cookie before updating local
storage. Adding an account opens the existing login page in a new tab. Signing
out affects the current session and leaves other saved accounts available for
future login; temporary-account deletion requires explicit confirmation.

The toolbar refreshes when another Puter tab changes the active session. The
helper emits `puter:session-changed` from the iframe on switching or sign-out:

```js
document.querySelector('[data-puter-toolbar]').addEventListener(
  'puter:session-changed',
  () => {
    // Reconcile the host app's session through its existing authentication flow.
    // Preserve unsaved work before changing the host app's active account.
  },
);
```

This event does not change the host app's SDK token. No tokens, account details,
or app lists are sent to the host. Both sides check message origin and source.
Both embed routes use the framing/session rules below. If sandboxing the toolbar,
allow scripts, same-origin storage, popups, and popups to escape the sandbox.

# Standalone app browser

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
all subdomains of `config.domain`, using the scheme and port from `config.origin`.
For example, `https://puter.com` permits `https://spreadsheet.puter.com`, and
`http://puter.localhost:4100` permits `http://spreadsheet.puter.localhost:4100`.
All ancestors in a nested iframe chain must be allowed. Other GUI routes retain
`X-Frame-Options: SAMEORIGIN`.

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
The normal GUI webpack build emits `bundle.min.js`, `apps-embed.min.js`,
`toolbar-embed.min.js`, and `toolbar-host.min.js`.
No puter.js API or app-list endpoint changes are needed.

Run the GUI component/browser tests (with the SDK bundle built and Playwright
Chromium installed), and the backend route tests:

```sh
npx vitest run --config src/gui/vitest.config.js src/gui/src/UI/Dashboard/AppBrowser
npx vitest run --config src/backend/vitest.config.ts src/backend/server.test.ts
```
