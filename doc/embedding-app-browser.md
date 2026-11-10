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

## Implementation

`createAppBrowser` in `src/gui/src/UI/Dashboard/AppBrowser.js` owns the shared UI
and data behavior; its `guestApps` option is the signed-out list. `TabApps.js`
injects desktop actions. `appsEmbed.js` supplies new-tab launching through
`launchAppInTab` (signed in) and `guestAppLaunchUrl` (signed out) in
`src/gui/src/helpers/appTabLaunch.js`, which build the same app URL as
`launch_app`, and loads only the embed entry, its SDK, and shared styles. `embedHostUser` in
`src/gui/src/helpers/embedHostUser.js` reads the host's user from the fragment, and
`embedHostTheme.js` beside it applies the host's theme.
The normal GUI webpack build emits `bundle.min.js`, `apps-embed.min.js`, and `feedback-embed.min.js`.
The `/embed/apps` route puts the recommended list in the page's config as
`guestApps`. No puter.js API or app-list endpoint changes are needed.

## Feedback dialog

`GET /embed/feedback` is the app feedback dialog (`puter.ui.showFeedbackDialog()`)
for a first-party page, with the same framing rules, query redirect, and
host-user binding as `/embed/apps`. It sends the feedback for the framing
page's origin, which the server reads from the referrer and pins with
`frame-ancestors`; opened top-level, it does nothing. Its page is transparent
so the dialog's own scrim covers the host.

puter.js uses it on a page one label under the GUI origin, other than the
subdomains the server refuses, when the page is signed in, framing it in a
modal `<dialog>` that stays hidden until the embed is ready. A session check that takes longer than 200ms shows a loading scrim
with a spinner in its place; Escape or a click on it cancels. The embed posts `{ msg: 'feedbackEmbed', state }` to its parent
(`loading`, then `ready` or `unavailable`) and finally
`{ msg: 'feedbackDialogClosed', sent }`. It reports `unavailable` without the
named user's session, or while that user's email still needs confirming, and
puter.js then uses the `/action/send-feedback` popup, which can sign in. So does
a frame that never answers, such as one the host's CSP blocks. `feedbackEmbed.js`
is the entry, sharing `embedSession` in `src/gui/src/helpers/embedSession.js`
with the app browser; `showFeedbackEmbed` in `src/puter-js/src/lib/guiEmbed.js`
is the host side.

## Sign-in and file pickers

`GET /embed/sign-in`, `/embed/show-open-file-picker`, `/embed/show-save-file-picker`
and `/embed/show-directory-picker` serve the same GUI popups as `/action/<action>`
for a first-party page, with the same framing rules, query redirect, and
`no-store` as `/embed/apps`. Any other spelling of the path (another case, a
trailing slash) redirects to it, since the shell boots the desktop for it. They render the normal GUI shell, which names the
framing page (read from the referrer, pinned with `frame-ancestors`) as
`gui_params.embed_host_origin`. The GUI then runs the popup boot unchanged, with
the framing page as `window.opener`, and `window.close()` asks the page to
remove the frame (`src/gui/src/helpers/popupFrame.js`). Without a framing page
to answer (opened top-level, or framed by a refused page) it does nothing. The
popup's parameters come from the fragment instead of the query: `msg_id`,
`options` and `request_auth`, plus `user` for a picker.

The frame posts `{ msg: 'puterPopupFrame', state }` to its parent: `loading` as
soon as the shell boots, `ready` once it shows a window or dialog, `unavailable`
when the page has to use the popup, `provider` when the user picks a sign-in
provider (below), and `closed` where a popup would close. Its
answers (`puter.token`, `fileOpenPicked`, `directoryPicked`, `fileSaved`, the
cancel messages, `sendMeFileData`) are the popup's.

puter.js uses them on a page one label under the GUI origin, other than the
subdomains the server refuses, unless the page is cross-origin isolated or in a
frame of another site (which `frame-ancestors` refuses too).
`showPopupFrame` in `src/puter-js/src/lib/guiEmbed.js` shows the frame in a box
the size of the popup window, over a scrim, hidden until `ready` and behind the
loading spinner after 200ms. Escape closes it, on the page or in the frame. One shows per popup, as each
popup has its own window name: a second picker request of the same kind
replaces the one showing, and a `signIn()` call made while a framed sign-in is
open settles with it. On
screens up to 600px wide the box fills the screen. A frame that is refused,
never answers, or reports `unavailable` falls back to the popup, opened through
a consent dialog when the click that asked for it has expired. A reload or navigation the frame
starts itself (logging out, a sign-out in another tab) names the frame as its
referrer, so the server refuses it; the page then shows its spinner and opens
the frame again, once per `ready`.

- **Sign-in** (`puter.auth.signIn()`) has no host-user binding: it is how the
  page gets a user. The box has a close button, which rejects with
  `auth_window_closed` as closing the popup does. Providers refuse to be
  framed, so choosing one posts `{ state: 'provider', url }` with the
  provider's start URL for this sign-in's `msg_id`, then `unavailable`. The
  page opens the popup straight at that URL, once it checks the URL is the
  GUI's `/auth/oidc/<provider>/start` for this `msg_id`, and the provider
  returns it as this sign-in's popup. `attempt_temp_user_creation` keeps the popup, since
  only the popup creates a temporary account.
- **Pickers** frame only for a signed-in page. The GUI reports `unavailable`
  unless its session belongs to the user named in `user`, and the page then uses
  the popup, which can sign in and switch accounts. The token the GUI sends
  before a picker's answer isn't adopted, since it is for the page's own user.
  Dismissing the loading scrim settles the picker as cancelled.

## Upgrade

`GET /embed/upgrade` is the deployment's upgrade dialog for a first-party page,
served like the popups above: the GUI shell with the same framing rules, query
redirect, exact-path redirect and `no-store`, naming the framing page as
`gui_params.embed_host_origin`. It runs only when framed by an allowed page.

puter.js frames it on a signed-in first-party page (the same pages as the
pickers) for `puter.ui.requestUpgrade(details)`, and for the Upgrade button of
the usage limit dialog a refused call shows there. Elsewhere both keep their
behavior: inside an app `requestUpgrade()` asks the desktop, and on any other
page the usage limit dialog opens the dashboard's upgrade page in a new tab.

The frame covers the page with no box or close button, and the GUI page is
transparent (`html.popup-frame-transparent`) so the dialog's own scrim covers
the host. The frame allows `payment` as well as `otp-credentials`. Escape on the
page is left to the dialog, since one there shouldn't drop a payment in
progress. Its fragment names `user` (the page's signed-in user) and, when the
refusal gave them, `reason` (`funds`, `subscription` or `storage`) and `method`.

The GUI reports `unavailable` unless its session belongs to `user`, the account
has no verification or password change waiting (which the frame couldn't be
closed from), and the deployment defines `window.UIUpgradeAccount` with
`UIUpgradeAccount.embeddable === true`. Otherwise it runs:

```js
new UIUpgradeAccount({ attribution: { appUid, reason, method }, onClose }).open_as_window();
```

`appUid` is the app the framing page's origin resolves to, never one the
fragment names. `open_as_window()` resolves once the dialog shows, and the GUI
then posts `ready`. While the page still hides the frame, which Chromium and
WebKit lay out at 0x0, the GUI posts `ready` first and opens the dialog once
the frame has a viewport, so a window it opens doesn't center on 0x0.
`onClose({ upgraded })` must run exactly once, when the
dialog closes or when it declines to open for the account; the GUI then posts
`{ msg: 'puterPopupFrame', state: 'closed', upgraded }` and the page removes
the frame. If `open_as_window()` rejects, the GUI posts `unavailable` instead. `requestUpgrade()` resolves `{ upgraded }`. A call made while the
frame shows settles with it rather than replacing it, and a call refused while
it shows still rejects but opens no usage limit dialog over it.

When the frame can't show the upgrade (refused, never ready, `unavailable`, or
no user to name), puter.js opens the dashboard's upgrade page in a new tab with
what was refused, through a consent dialog when the click has expired or the
tab is blocked, and `requestUpgrade()` resolves `{ upgraded: false }`.

## Top-up

`GET /embed/top-up` is the deployment's top-up dialog, where a user with a plan
buys add-on credit, served and framed like the upgrade: a transparent GUI page
covering the host with no box or close button, allowing `payment` and
`otp-credentials`, with Escape left to the dialog. Its fragment names `user`.

puter.js frames it for the **Add credits** item of `<puter-user-menu>`, which
shows only when whoami reports `subscribed: true` and no `team` paying for the
account. On a page that can't frame the GUI, the item opens the dashboard with
`?topup=` in a new tab instead.

The Low Balance dialog puter.js shows on a website when a call is refused for
credit offers the same top-up to the same accounts: **Add Credits** is its main
button, with **Upgrade Plan** beside it. Everyone else gets **Upgrade Now**
alone.

The GUI reports `unavailable` unless its session belongs to `user`, the account
has no verification or password change waiting, and the deployment defines
`window.UITopUp` with `UITopUp.embeddable === true`. Otherwise it runs:

```js
new UITopUp({ onClose }).open();
```

`open()` resolves once the dialog has loaded the account and shows what it can
buy, and `onClose({ toppedUp })` must run exactly once, when the dialog closes
or when it declines to open for the account. The GUI then posts `{ msg: 'puterPopupFrame', state: 'closed', toppedUp }`
and the page removes the frame. When the frame can't show the top-up, puter.js
opens the dashboard's top-up in a new tab, as it does the upgrade.

While the top-up shows, a call refused for funds still rejects but opens no
usage limit dialog over it, and `requestUpgrade()` frames nothing over it: it
resolves `{ upgraded: false }` once the top-up closes.

## Email confirmation

`GET /embed/request-email-confirmation` walks a first-party page's user through
confirming their email, served like the upgrade: the GUI shell with the same
framing rules, redirects and `no-store`, run only when framed by an allowed
page. puter.js frames it on a signed-in first-party page for
`puter.ui.requestEmailConfirmation()`. Inside an app the desktop shows the same
windows over the app instead.

Like the upgrade, the frame covers the page with no box or close button, over a
transparent GUI page, and its fragment names `user`. Escape closes it, on the
page or on the save-account or code window. On a window, Escape closes that
window as its close button does, so a code already sent still answers. The GUI
reports `unavailable` unless its session belongs to `user` and the account has
no phone, card or password check waiting.
An email check is fine: the boot skips its own email gate for this action, so
the user gets one code window they can close.

The GUI then runs `ensureConfirmedEmail` (`src/gui/src/helpers/ensureConfirmedEmail.js`),
which the desktop's handler uses too: a temporary account gets the save-account
window first, then an unconfirmed email gets the code window, each at most
once. When the page's whoami already reads the email as confirmed,
`requestEmailConfirmation()` resolves `{ response: true }` without framing
anything, and a confirmation in the frame marks that whoami confirmed for the
calls after it. An email the GUI reads as confirmed shows nothing. Before
opening a window the GUI waits for the frame to have a viewport, as the upgrade
does. It then posts
`{ msg: 'puterPopupFrame', state: 'closed', confirmed }`, and
`requestEmailConfirmation()` resolves `{ response: confirmed }`, the field an
app reads from the desktop's answer. A call made while the frame shows settles
with it. A frame that is refused, never ready, or `unavailable` resolves
`{ response: false }`, since there's no popup to fall back to.

## Checks

Run the GUI component/browser tests (with the SDK bundle built and Playwright
Chromium installed), and the backend route tests:

```sh
npx vitest run --config src/gui/vitest.config.js src/gui/src/UI/Dashboard/AppBrowser src/feedbackEmbed
npx vitest run src/puter-js/src/lib/guiEmbed.test.js src/puter-js/src/modules/UI.showFeedbackDialog.test.js src/puter-js/src/modules/Auth.signInFrame.test.js src/puter-js/src/modules/UI.pickerFrame.test.js src/puter-js/src/modules/UI.requestUpgrade.test.js src/puter-js/src/modules/UI.showTopUp.test.js src/puter-js/src/lib/upgradePrompt.test.js src/puter-js/src/modules/UsageLimitDialog.upgrade.test.js
npx vitest run --config src/gui/vitest.config.js src/gui/src/helpers/popupFrame.test.js
npx vitest run --config src/backend/vitest.config.ts src/backend/server.test.ts
```
