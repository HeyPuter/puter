# Embedded app browser

`GET /embed/apps` on the deployment's main GUI origin renders the same app browser
as the dashboard's Apps tab, without the desktop or dashboard navigation.

It supports search, paging, saved folders, and saved ordering. It uses the same
installed-app and recommendation data as the dashboard, including the user's
removed recommendations. Editing, adding, reordering, renaming, and uninstalling
are disabled. Selecting an app opens it in a new browser tab at its own URL, the
same way the dashboard does, and the host page stays open. The app's token isn't
put in the URL: the app's SDK asks the embed for it once the tab loads, so the
embed must still be open then. If the iframe is removed first, the app falls back
to its normal sign-in. Apps that need the desktop (built-in and godmode apps,
private apps the user can't open, or a failed token request) open `/app/<name>`
on the GUI origin, cut off from the embed. Website shortcuts open their external
destination with no opener.
The embed follows the OS's light or dark setting. A host with a fixed theme adds
`theme=dark` or `theme=light` to the fragment (`#user=<uuid>&theme=dark`), since
Chromium doesn't pass an iframe's `color-scheme` on to the page inside it.
Apps opened from the embed carry `utm_source=puter.com&utm_medium=referral&utm_campaign=app_browser_embed`;
the desktop and dashboard send `utm_campaign=desktop` and `utm_campaign=dashboard`.

## Session and framing

The embed shows the GUI session only to the user the host page is signed in as.
The host names that user's `uuid` (from `puter.auth.getUser()`) in the iframe
URL's fragment, as `/embed/apps#user=<uuid>`. The embed reads the session, asks
`/whoami` which user it belongs to, and shows the signed-out view unless the two
match. So a host that names no user, a malformed one, or a user other than the
session's, gets the signed-out view, and so does a session the API refuses. A
failed `/whoami` check shows the error state. The fragment never reaches the
server and can only narrow what the embed shows: naming the session's own user
gives the same view as a direct visit to the GUI. Changing the fragment of a
loaded embed reloads it.

The embed reads the existing GUI session from local storage on its own origin.
If that storage holds no session, the embed gets the session from the GUI origin's session cookie through
`/get-gui-token`. This matters in Safari, which gives a framed origin separate
local storage under each top-level origin, so even a sibling subdomain's iframe
can't see the GUI's stored token. The session cookie is still sent, because the
host is on the same site. The embed doesn't write that token back to storage. It
does not create accounts, show a login dialog, or accept a token from its parent.
Being signed in on a subdomain alone does not create a session on the main GUI
origin.

Without a session it can show, the embed shows the recommended apps (`RecommendedAppsService`)
that the server put in the page, and nothing else: no installed apps, folders, or
saved order, and no puter.js. Selecting one opens it at the same URL a signed-in
launch uses, with no opener and no token on offer, so the app signs in on its own.
Apps that need the desktop open `/app/<name>`. If the page carries no recommended
apps, or a load fails, the embed displays an unavailable/error state.

The route's `Content-Security-Policy: frame-ancestors` allows the GUI origin and
the embedding page's origin when it is exactly one label under `config.domain`
with the scheme and port from `config.origin`. Subdomains the server answers
itself (`api`, `dav`, `js`, `www`, the native-app hosts, and the host of
`api_base_url`) and the user-content hosting domains (`static_hosting_domain`,
`private_app_hosting_domain`, and their `_alt` variants) are refused. For
example, `https://puter.com` permits `https://spreadsheet.puter.com` but not
`https://api.puter.com`, and `http://puter.localhost:4100` permits
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

A first-party app that signs in with puter.js can place `<puter-user-menu>` from
the SDK in its header instead (see `src/puter-js/src/ui/components.md`). It opens
this embed with the signed-in user named and closes it when the app's sign-in
changes. The rest of this section is for a host that builds the iframe itself.

The iframe can be shown whether or not the user is signed in. Create it when
“More apps” is opened, naming the signed-in user in its fragment, and remove it
on close so reopening loads current apps and preferences. Remove it when the
host's own sign-in changes too, such as on sign-out, so an open embed doesn't
keep the previous user. The host owns the modal and close control;
there is no parent messaging API and no app list or credential is sent to it.
The app browser fills its iframe and responds to its size. It shows a spinner until its apps load.

This example assumes `puterOrigin` comes from the host app's deployment
settings. Translate the button and frame labels using the host app's
localization system.

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

  trigger.addEventListener('click', async () => {
    const url = new URL('/embed/apps', puterOrigin);
    // Signed out, the embed shows the recommended apps.
    const user = puter.auth.isSignedIn() ? await puter.auth.getUser().catch(() => null) : null;
    if (user) url.hash = `user=${encodeURIComponent(user.uuid)}`;
    const frame = document.createElement('iframe');
    frame.title = 'Your apps';
    frame.src = url.href;
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
and data behavior; its `guestApps` option is the signed-out list. `TabApps.js`
injects desktop actions. `appsEmbed.js` supplies new-tab launching through
`launchAppInTab` (signed in) and `guestAppLaunchUrl` (signed out) in
`src/gui/src/helpers/appTabLaunch.js`, which build the same app URL as
`launch_app`, and loads only the embed entry, its SDK, and shared styles. `embedHostUser` in
`src/gui/src/helpers/embedHostUser.js` reads the host's user from the fragment, and
`embedHostTheme.js` beside it applies the host's theme.
The normal GUI webpack build emits `bundle.min.js` and `apps-embed.min.js`.
The `/embed/apps` route puts the recommended list in the page's config as
`guestApps`. No puter.js API or app-list endpoint changes are needed.

Run the GUI component/browser tests (with the SDK bundle built and Playwright
Chromium installed), and the backend route tests:

```sh
npx vitest run --config src/gui/vitest.config.js src/gui/src/UI/Dashboard/AppBrowser
npx vitest run --config src/backend/vitest.config.ts src/backend/server.test.ts
```
