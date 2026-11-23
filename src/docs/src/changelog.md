# Puter.js Changelog

New features, changes, and fixes in Puter.js and the Puter APIs, grouped by day, newest first.

## November 23, 2026

- Changed Puter.js in an app that Puter opens in its own browser tab to remove the `puter.*` launch parameters from the address bar once the page has loaded, keeping the app's other query parameters and its URL hash. Code that reads them from `location.search` has to do so before or during the `load` event.
- Fixed [`puter.ui.onLaunchedWithItems()`](/UI/onLaunchedWithItems/) and [`puter.ui.wasLaunchedWithItems()`](/UI/wasLaunchedWithItems/) missing the opened item when the app changed its URL before calling them.
- Fixed a private app that Puter opens in its own browser tab missing the opened item from [`puter.ui.onLaunchedWithItems()`](/UI/onLaunchedWithItems/) when the user had to sign in to the app first.

## November 22, 2026

- Fixed [`puter.fs.getReadURL()`](/FS/getReadURL/) refusing files that the app or user can read through access to a parent folder, such as a folder shared with the user.
- Fixed [`puter.fs.write()`](/FS/write/) answering `dest_does_not_exist` when the path spelled an existing folder in another letter case or Unicode form. The file is written into that folder.
- Fixed launch arguments passed with [`puter.ui.launchApp()`](/UI/launchApp/) reaching the app with their percent-escapes decoded, so `%20` arrived as a space. A `%` that isn't part of an escape also stopped Puter.js from loading in the launched app.
- Fixed the `stats_period` values `month_to_date`, `year_to_date` and `last_12_months` of [`puter.apps.get()`](/Apps/get/) returning all-time counts. A `stats_period` that isn't one of the listed values is rejected with `bad_request`.

## November 21, 2026

- Changed the pickers that [`puter.ui.showOpenFilePicker()`](/UI/showOpenFilePicker/), [`puter.ui.showSaveFilePicker()`](/UI/showSaveFilePicker/) and [`puter.ui.showDirectoryPicker()`](/UI/showDirectoryPicker/) open to look and work like the Files tab of the Puter dashboard, with its folders sidebar, breadcrumbs, list and grid views, sorting, and keyboard navigation.
- Fixed `undefinedOnCancel` of those pickers not resolving in a Puter app when the user closed the picker with Escape or its close button.
- Fixed [`puter.ui.showDirectoryPicker()`](/UI/showDirectoryPicker/) giving the folder the picker was open in a path with the username in it. Its path starts with `~/`, as a selected folder's does.

## November 20, 2026

- Changed [`puter.ai.chat()`](/AI/chat/) to reject audio with `bad_request` when the model does not support audio input. This covers audio parts, audio from a Puter file, and audio or video `data:` URLs sent in an image part.
- Fixed video and Puter file audio input in [`puter.ai.chat()`](/AI/chat/) on Gemini models.
- Added the `senderAuth` field to the [`EmailMessage`](/Objects/emailmessage/) from [`puter.email.get()`](/Email/get/). It holds the result of Puter's check that mail naming a Puter domain as its sender really came from that domain.

## November 18, 2026

- Changed removing an app from a Puter account to also delete the workers that app deployed there with [`puter.workers.create()`](/Workers/create/). A worker bound to an app the user owns is kept.

## November 17, 2026

- Added URL lookups to [`puter.apps.get()`](/Apps/get/). Pass a URL such as `https://my-app.puter.site/about` instead of a name to get the app at that URL's origin. See [Getting an app by URL](/Apps/get/#getting-an-app-by-url).
- Fixed [`puter.ui.contextMenu()`](/UI/contextMenu/) menus with a submenu inside a submenu staying open after an item in the inner submenu was chosen. The inner submenu also closes when the submenu it belongs to closes.

## November 16, 2026

- Changed [`puter.fs.upload()`](/FS/upload/) to reject an upload with `invalid_upload_path` when a file or folder path resolves outside the destination folder, such as a path with `..` segments.
- Added the `background` option to [`puter.notifications.enable()`](/Notifications/enable/). It turns pushes back on without a click, such as on page load, and never opens a prompt, dialog, or sign-in window. See [Calls without a click](/Notifications/enable/#calls-without-a-click).
- Added [`puter.hosting.detach()`](/Hosting/detach/), which opens a Puter dialog where the user removes custom domains from one of their websites.
- Added the `custom_domains` field to the [`Subdomain`](/Objects/subdomain/) objects from [`puter.hosting.get()`](/Hosting/get/) and [`puter.hosting.list()`](/Hosting/list/). Also added `previousSite` to the [`CustomDomain`](/Objects/customdomain/) from [`puter.hosting.attach()`](/Hosting/attach/), for when the user moved the domain from another of their websites.
- Added the `drain` event to [`puter.net.Socket`](/Networking/Socket/) and [`puter.net.tls.TLSSocket`](/Networking/TLSSocket/). It fires once the data written before the socket opened has been sent.
- Fixed [`puter.net.Socket`](/Networking/Socket/) and [`puter.net.tls.TLSSocket`](/Networking/TLSSocket/) closing with an error when a `data` handler threw. Also fixed `off()` on a [`puter.net.tls.TLSSocket`](/Networking/TLSSocket/) not removing `open`, `data`, or `close` handlers.
- Fixed Node.js scripts that use Puter.js not exiting after their work finished.

## November 15, 2026

- Fixed [`puter.workers.create()`](/Workers/create/) failing with a server error for a worker name longer than 50 characters, or when another user owns the worker's `sandbox-<workerName>` app. It rejects with `bad_request` or `sandbox_not_owned` instead.
- Changed [`puter.workers.delete()`](/Workers/delete/) to also delete the worker's `sandbox-<workerName>` app, unless another worker still runs as it. A worker you create later with the same name starts with empty key-value data and an empty AppData folder.

## November 14, 2026

- Changed [`puter.ai.chat()`](/AI/chat/) so a request that a Claude model declines runs again on an earlier Claude model, and later calls in the same conversation stay on the model that answered. To get the refusal instead, pass `refusalFallback: false`. See [Refusal fallback](/AI/chat/#refusal-fallback).
- Added the `speed` option to [`puter.ai.chat()`](/AI/chat/) for Claude models. Set it to `"fast"` for Fast mode or `"standard"` for standard inference. See [Anthropic models](/AI/chat/#anthropic-models).
- Added `puterId` to every model that [`puter.ai.listModels()`](/AI/listModels/) returns. It holds the full `<service>:<provider>/<model>` name, which [`puter.ai.chat()`](/AI/chat/) accepts as `model`.
- Changed the `mistral-large-latest`, `mistral-large`, and `mistralai/mistral-large-latest` model names in [`puter.ai.chat()`](/AI/chat/) to point to Mistral Large 4 instead of Mistral Large 3.
- Changed the AI concurrent request limit so a chat request you stop keeps counting until the model finishes. Sending new requests right after stopping a few can hit the limit. See [Rate Limits and Quotas](/rate-limits-and-quotas/#ai).
- Changed [`puter.ai.txt2img()`](/AI/txt2img/) on Replicate models to try again when the model's safety checker rejects the image and you didn't set a `seed`. Only the run that succeeds is charged. See [Replicate models](/AI/txt2img/#replicate-models).
- Fixed apps opened from the Puter desktop at desktop.puter.com not getting messages from the desktop. Their windows didn't close, and [`puter.ui.onWindowClose()`](/UI/onWindowClose/), [`puter.ui.onItemsOpened()`](/UI/onItemsOpened/), and the `localeChanged` event of [`puter.ui.on()`](/UI/on/) didn't fire.

## November 13, 2026

- Fixed [`puter.kv.set()`](/KV/set/) failing with a server error when a value under the size limit takes more than 400 KB once stored. It rejects with `value_too_large`.
- Fixed URLs from [`puter.fs.getReadURL()`](/FS/getReadURL/) sometimes failing right after the call resolved, and sending an invalid `Content-Type` for a file with no known extension, such as `README`.
- Fixed [`puter.fs.write()`](/FS/write/), [`puter.fs.copy()`](/FS/copy/), and [`puter.fs.move()`](/FS/move/) replacing an item whose name differs from the new name only by accents or emoji, such as `😀.txt` and `😁.txt`. The call keeps the existing item and rejects, unless you set `dedupeName: true`.
- Fixed [`puter.fs.write()`](/FS/write/) not overwriting a file in place when the new name differs from the existing name only in letter case or Unicode normalization, such as `notes.txt` and `Notes.txt`.
- Fixed [`puter.auth.getMonthlyUsage()`](/Auth/getMonthlyUsage/) and [`puter.auth.getDetailedAppUsage()`](/Auth/getDetailedAppUsage/) resolving to the server's error body when the request failed. They reject with an error that has `status` and `message`.
- Fixed [`puter.auth.signIn()`](/Auth/signIn/) on a cross-origin isolated page sometimes not finishing after the user signed in, and rejecting with `auth_timeout`.
- Fixed apps opened on a file inside a folder shared with the user, such as a file from [`puter.ui.onLaunchedWithItems()`](/UI/onLaunchedWithItems/), not being able to read or save that file.
- Fixed [`puter.ui.showSaveFilePicker()`](/UI/showSaveFilePicker/) with `type: 'url'` not saving the URL's contents. See [Saving from a URL](/UI/showSaveFilePicker/#saving-from-a-url).
- Fixed queued events from [`puter.events.onPersistent()`](/Events/onPersistent/) going to the events worker while a client with the `handler` function was still running them. A queued event goes only to clients that run its handler.
- Changed the Puter desktop to ignore a push permission your app got only through [`puter.notifications.enable()`](/Notifications/enable/) on your website. In Puter apps, [`requestPermission()`](/Notifications/requestPermission/) and [`enablePush()`](/Notifications/enablePush/) show Puter's permission dialog for it, and [`status()`](/Notifications/status/) resolves to `'off'` until the user allows it there.

## November 12, 2026

- Added the `failed` array to the result of [`puter.fs.unshare()`](/FS/unshare/). It lists each recipient and item pair that was refused, with its `message` and `code`. When every pair is refused, the call rejects with `{ message, code, failed }`, unless every refusal was `user_does_not_exist` or `subject_does_not_exist`.
- Changed [`puter.ui.showColorPicker()`](/UI/showColorPicker/) in Puter apps to resolve to a lowercase 6-digit hex string, such as `#ff0000`, or to `null` if the user closes the picker. Before, it resolved to an 8-digit hex string with alpha, or to `undefined`. On websites, it also opens when the default color has alpha or isn't a valid hex color.
- Removed the `themeChanged` event of [`puter.ui.on()`](/UI/on/). It has no replacement, and a handler for it never runs.
- Deprecated the `show_in_taskbar` option of [`puter.ui.createWindow()`](/UI/createWindow/). It has no effect, because the Puter desktop doesn't have a taskbar anymore.

## November 11, 2026

- Changed [`puter.ai.speech2speech()`](/AI/speech2speech/) to reject any `model` other than `eleven_multilingual_sts_v2` or `eleven_english_sts_v2` with a `field_invalid` error.

## November 10, 2026

- Fixed a file becoming unreadable when two [`puter.fs.write()`](/FS/write/) calls created the same new file at the same time. The last write wins.

## November 9, 2026

- Added the `serviceSpeed` option to [`puter.ai.chat()`](/AI/chat/) to ask for `"standard"`, `"fast"`, or `"ultrafast"` service. Faster service can cost more, and `usageDetails.serviceSpeed` reports the speed that served the request. See [Service speed](/AI/chat/#service-speed).

## November 7, 2026

- Renamed `puter.ai.convo()` to [`puter.ai.realtime()`](/AI/realtime/) (beta). It takes the same options, and the `Convo*` TypeScript types are now `Realtime*` types, such as `RealtimeOptions`. Calls to `puter.ai.convo()` throw, so switch them to [`puter.ai.realtime()`](/AI/realtime/).

## November 6, 2026

- Changed [`puter.notifications.enable()`](/Notifications/enable/) on a website to show a Puter dialog when it isn't called from a click, or when the click has expired, such as after a sign-in window. The browser's prompt opens from the dialog's Continue button, and Cancel resolves to `false`. Before, the call rejected with `user_gesture_required`.

## November 5, 2026

- Added [`puter.notifications.markShown()`](/Notifications/markShown/) and [`puter.notifications.dismiss()`](/Notifications/dismiss/), so the next notification with the same `group` creates a new one instead of replacing it. A dismissal also closes the notification on the user's other devices, and fires the `dismiss` event of [`puter.notifications.on()`](/Notifications/on/).
- Added `priority: 'high'` to [`puter.notifications.notify()`](/Notifications/notify/) for pushes that need to arrive right away, such as an incoming call.
- Added `requireInteraction` and `actions` to what an [`onPush()`](/Notifications/onPush/) handler can return, so a push can stay on screen and show buttons. The id of the pressed button reaches the `click` event of [`puter.notifications.on()`](/Notifications/on/) as `action`.
- Added [`puter.events.updateSchedule()`](/Events/updateSchedule/) (beta) to change a schedule's timing or context, or a notification stored with `sendAt`, without changing its id.
- Removed notifications shown by the page itself. A page of your website in the background no longer shows a notification from your [`onPush()`](/Notifications/onPush/) handler. Puter pushes it to every browser where the user turned pushes on, unless a page of your app is visible and focused when it arrives. See [When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed).
- Added the `prompt_cache_options` option to [`puter.ai.chat()`](/AI/chat/#openai-models) for GPT-5.6 and later OpenAI models. It sets a 30 minute or 12 hour cache lifetime.
- Changed `usageDetails` from [`puter.ai.chat()`](/AI/chat/) on OpenAI models to report cache writes as `cacheWrite30mTokens` and `cacheWrite12hTokens` instead of `cacheWrite5mTokens`. See [ChatResponse](/Objects/chatresponse/).
- Changed the default model of [`puter.ai.txt2img()`](/AI/txt2img/) from `gpt-image-2` to `gpt-image-2.6-flare`. To keep the old model, pass `model: 'gpt-image-2'`.
- Added the `context_trimmed` event to [`puter.ai.convo()`](/AI/realtime/). It fires after a reconnect when older items were left out of the restored context. Before, that case fired an `error` event with `context_restore_failed`.
- Changed `interrupt()` on a [`puter.ai.convo()`](/AI/realtime/) conversation to return a promise that rejects with `session_not_ready` or `session_closed` instead of throwing when the conversation isn't ready. Also changed `connect()` to retry temporary setup failures before it rejects.
- Fixed [`puter.ai.convo()`](/AI/realtime/) ending the conversation when the server sent an event over 64 KiB, and its microphone capture stopping after a reconnect.
- Changed the [Realtime WebSocket API](/AI/realtime-websocket/) to close with code 1011 and an `internal_error` when a server error stops Puter from checking your credential or plan, instead of `invalid_api_key` with code 1008. It closes with 1013 when the server is overloaded. Reconnect after 1011, 1012, or 1013.
- Added the `purpose=handover` query parameter to the [Realtime WebSocket API](/AI/realtime-websocket/) for opening a replacement connection while the current one still works.
- Fixed input transcription on the [Realtime WebSocket API](/AI/realtime-websocket/) failing to turn on for users with little credit.

## November 4, 2026

- Added inline handlers to [`puter.events.onSchedule()`](/Events/onSchedule/) and [`puter.events.onPersistent()`](/Events/onPersistent/) (beta). Pass your code as `handler` without a `handlerName`, and Puter publishes it in the signed-in user's own [user scope](/Events/handlers/#user-scope).
- Added the `scope: 'user'` option to [`puter.events.handlers`](/Events/handlers/), and the `handlerScope` option to [`onSchedule()`](/Events/onSchedule/) and [`onPersistent()`](/Events/onPersistent/), so a user's session can publish named handlers in its own scope and bind to them.
- Added the `from` option to [`puter.events.fetch()`](/Events/fetch/) (beta). With `from: 'end'`, a read without a cursor returns no items and a cursor at the newest notification, so later reads return only newer notifications.
- Added `puterPush.savedHandlers()` for the push service worker. Call it with `false` to run only the handlers registered in the worker, never the handler source your pages saved with [`onPush()`](/Notifications/onPush/#handlers-in-the-worker).
- Fixed the `off()` function from [`onPush()`](/Notifications/onPush/) removing the saved handler while another tab still used it, and pages with a push handler being kept out of the browser's back/forward cache.
- Fixed [`puter.notifications.enable()`](/Notifications/enable/) rejecting with `push_subscription_conflict` for a subscription Puter made earlier with an older key, and pushes stopping after the browser replaced its subscription.
- Fixed notifications sent from a website that uses Puter.js naming the app by its uid. The notification's `app.name` is the site's hostname.

## November 3, 2026

- Added schedules to the [Events API](/Events/) (beta). A handler can run at an interval, on a cron expression, or once at a set time, even while your app is closed. Create one with [`puter.events.onSchedule()`](/Events/onSchedule/), and manage them with [`listSchedules()`](/Events/listSchedules/), [`getSchedule()`](/Events/getSchedule/), and [`removeSchedule()`](/Events/removeSchedule/).
- Added the `sendAt` option to [`puter.notifications.notify()`](/Notifications/notify/#send-it-later) to send a notification at a set time, and [`puter.notifications.cancel()`](/Notifications/cancel/) to cancel it before it goes out. With a `sendAt` more than 5 seconds ahead, [`notify()`](/Notifications/notify/) resolves to `{ scheduleId, sendAt }` instead of a notification `uid`.
- Changed [`puter.auth.signOut()`](/Auth/signOut/) to return a `Promise`. On a website, it also ends this browser's push subscription for your app, and so does a different user signing in.
- Fixed [`puter.notifications.disable()`](/Notifications/disable/) ending a push subscription that another service, such as Firebase, made on your site. Only the subscription Puter made is removed.
- Fixed [`puter.notifications.onPush()`](/Notifications/onPush/) opening the Puter sign-in window when it renewed the subscription on page load, and other tabs subscribing again after [`disable()`](/Notifications/disable/) ran in one tab.
- Fixed taps on push notifications on a website. A tap opens one page, once, and a tap without a URL opens your site's root, or your service worker's folder when your pages are inside it.
- Fixed [`puter.ui.showFontPicker()`](/UI/showFontPicker/) in Puter apps ignoring the default font, and failing when given a font name as a string.

## November 2, 2026

- Changed [`puter.notifications.status()`](/Notifications/status/) on a website to check this browser's subscription with Puter. It resolves to `'off'` after the user removes this browser or turns your app off in Puter's settings, and page loads don't turn pushes back on in that browser until your page calls [`enable()`](/Notifications/enable/).
- Fixed three [Workers router](/Workers/router/) responses. A 404 for an unmatched path or method has the CORS header, a `fetch()` response returned by a handler is sent instead of becoming a 500, and a Puter.js error thrown in a handler comes back as JSON in the 500 body.
- Fixed [`puter.kv`](/KV/) writes rejecting some values over [`MAX_VALUE_SIZE`](/KV/MAX_VALUE_SIZE/) with `bad_request`. Every value over the limit rejects with `value_too_large`.

## October 31, 2026

- Added the `fallback` option to [`puter.ai.chat()`](/AI/chat/). Pass `false` to get the first provider's error, instead of having Puter retry the request on another provider that serves the same model.
- Changed how [`puter.ai.convo()`](/AI/realtime/) reconnects. It keeps trying for about a minute, restores up to 40 recent conversation items, and moves to a new session before a planned server restart.
- Added the `puter.reconnect` event to the [Realtime WebSocket API](/AI/realtime-websocket/). Puter sends it before the server a session runs on restarts, so your client can move to a new connection first.
- Changed realtime sessions to refuse `conversation.item.retrieve` events and MCP tools with an `invalid_event` error and a 1008 close.
- Changed [`puter.notifications.notify()`](/Notifications/notify/) so a notification reaches only the app that sent it. The Puter desktop's notifications panel doesn't show it.
- Changed the `group` option of [`notify()`](/Notifications/notify/#groups) to replace the newest notification your app sent the user in that group, unless that one was shown or dismissed. The replacement keeps the same `uid`, and [`onNotification()`](/Notifications/onNotification/) gets it again with `replaced: true`. A `group` can be up to 128 characters and contain `@`.
- Added [`puter.notifications.status()`](/Notifications/status/), which tells you whether your app's pushes reach the user's current browser, without prompting the user.
- Added the `notify` option to [`puter.kv.share()`](/KV/share/) and the `to` option to [`notify()`](/Notifications/notify/#notify-the-other-side-of-a-share), so the owner and the holder of a share can send each other notifications. The `kv.share.received` notification only goes out for shares made with `notify: true`.
- Added the `'pushNotifications'` resource to [`puter.perms.request()`](/Perms/request/), so you can ask for push permission in the same prompt as other access.
- Changed [`puter.notifications.enable()`](/Notifications/enable/) on a website to resolve once the browser has subscribed, without waiting for the confirmation push.
- Changed [`enable()`](/Notifications/enable/) and [`enablePush()`](/Notifications/enablePush/) in Puter apps to show Puter's permission dialog when your app doesn't have push permission yet. In Puter apps, [`disable()`](/Notifications/disable/) removes your app's push permission.
- Changed a `'kvShare'` request in [`puter.perms.request()`](/Perms/request/) to ask for `'read'` access when `access` is left out, the same default as [`puter.kv.share()`](/KV/share/).
- Added a rate limit on calls through share handles into one user's data for one app. Calls over it reject with `too_many_requests`. See [Rate Limits and Quotas](/rate-limits-and-quotas/#key-value-store).
- Changed [`puter.kv.share()`](/KV/share/) so a call that changes nothing for any recipient doesn't count toward the share limits. Your app can call it each time it opens to get the `handle` back.
- Changed [`puter.events.onLocal()`](/Events/onLocal/) subscriptions through a share handle to end with `subscription_ended` when the share stops. Key-value events through a `watch` share leave out the value, even with `includeValue`.
- Added [`puter.events.update()`](/Events/update/) (beta) to change a persistent subscription's `context` without ending it. The subscription keeps its `subId` and the events it hasn't delivered yet.
- Changed the events worker to retry a handler run that fails because of Puter, such as a `5xx` error, without counting it toward the failures that suspend a subscription.
- Added `app_uid` and `app_name` to the [`WorkerDeployment`](/Objects/workerdeployment/) object from [`puter.workers.create()`](/Workers/create/), and `app_name` to the [`WorkerInfo`](/Objects/workerinfo/) object. They name the app the worker runs as.
- Added `dnsProvider` and `redirectFrom` to the [`CustomDomain`](/Objects/customdomain/) object. When a root domain's DNS is on Route 53 or GoDaddy, the domain is added as its `www.` hostname, and an `A` record with the purpose `redirect` forwards the root domain to it.

## October 30, 2026

- Added [`puter.ai.convo()`](/AI/realtime/) (beta) for realtime voice and text conversations with OpenAI's realtime models. It has helpers for the microphone, playback, and interruptions, and needs a paid Puter plan.
- Added the [Realtime WebSocket API](/AI/realtime-websocket/) (beta) to use the same realtime models through Puter without Puter.js.
- Changed [`puter.notifications.notify()`](/Notifications/notify/) to push a notification only when no open page of your app answers within 5 seconds that it's visible and focused, or that it shows the notification itself. See [When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed).
- Changed push opt-in on websites to stay off until your page turns it on. On page loads, [`onPush()`](/Notifications/onPush/) keeps a browser subscribed only after [`enable()`](/Notifications/enable/), and stops after [`disable()`](/Notifications/disable/), after the user turns your app off in Puter, or after [`puter.auth.signOut()`](/Auth/signOut/).
- Added the `push_worker_conflict`, `push_subscription_conflict`, `push_subscribe_failed`, and `user_gesture_required` errors to [`puter.notifications.enable()`](/Notifications/enable/), and the `invalid_handler` error to [`onPush()`](/Notifications/onPush/).
- Changed the push service worker script to load from `https://js.puter.com/push-sw.js`. The old `https://js.puter.com/v2/push-sw.js` URL still works.
- Fixed [`puter.auth.signIn()`](/Auth/signIn/), [`puter.perms.request()`](/Perms/request/), and other calls that open a Puter popup showing nothing when the browser blocked the popup, such as in Safari and iPhone Home Screen web apps. They show a Continue dialog instead.

## October 29, 2026

- Added the [Notifications API](/Notifications/). Your app can send its user notifications with [`puter.notifications.notify()`](/Notifications/notify/), receive them live with [`onNotification()`](/Notifications/onNotification/), and, with the user's permission, send them as push notifications to their browser or phone. See [Push notifications for your app](/Notifications/push/).

## October 28, 2026

- Added the `queue` option to [`puter.events.onPersistent()`](/Events/onPersistent/) (beta) in place of `delivery: 'single'`, which still works. Subscriptions report `queue` instead of `delivery` and `targets`.
- Changed [`onPersistent()`](/Events/onPersistent/) subscriptions without `queue` to run the handler in your app's events worker and also send each event to every connected client. Before, each event went to only one of the two. The `targets` option is ignored.
- Changed queued deliveries to drop the event when the handler throws, instead of retrying it. Temporary errors and errors thrown with `retry: true` are still retried, and a connected client has 15 seconds to answer before the events worker takes the event. See [What happens when a handler fails](/Events/onPersistent/#what-happens-when-a-handler-fails).
- Fixed [`puter.net.Socket`](/Networking/Socket/) sending writes made right after it connects out of order, and treating an `open` listener that throws as a failed connection.
- Changed [`puter.ai.speech2txt()`](/AI/speech2txt/) on OpenAI models to ignore `response_format` and `stream` in `extra_body`. Set `response_format` as a top-level option instead.

## October 27, 2026

- Added [`puter.hosting.attach()`](/Hosting/attach/), which opens a Puter dialog where the user connects a domain they own to one of their websites. It resolves to a [`CustomDomain`](/Objects/customdomain/) object, or to `null` if the user closes the dialog.
- Fixed [`puter.perms.request()`](/Perms/request/) for the `'subdomains'` resource having no effect. With read access, [`puter.hosting.list()`](/Hosting/list/) and [`puter.hosting.get()`](/Hosting/get/) cover all of the user's websites, and write access adds [`puter.hosting.update()`](/Hosting/update/) and [`puter.hosting.delete()`](/Hosting/delete/).
- Fixed [`puter.ui.launchApp()`](/UI/launchApp/) never settling when the Puter desktop can't launch the app. It rejects with `ipc_handler_failed`.
- Changed [`puter.fs.listShared()`](/FS/listShared/) to mark items shared with one of your teams with `holderTeam`. Leaving an item you only have through a team with [`puter.fs.unshare()`](/FS/unshare/) rejects with `team_share`.
- Fixed [`puter.fs.readdir()`](/FS/readdir/) ignoring `offset` when `recursive` is `true`. Also fixed [`puter.fs.copy()`](/FS/copy/) onto an existing file, which replaces the file when `overwrite` is `true` and rejects otherwise.

## October 26, 2026

- Added sharing with up to 50 users in one [`puter.kv.share()`](/KV/share/) call (beta). Pass an array of recipients, and the call resolves to one result per recipient.
- Added the `appUid` option to [`puter.kv.listShared()`](/KV/listShared/) and [`puter.kv.listSharedByMe()`](/KV/listSharedByMe/), and the `state` option to [`listSharedByMe()`](/KV/listSharedByMe/) to list only live or only stopped shares. Stopped shares are kept for 30 days.
- Changed `watch` shares so the holder can list keys, without their values, with [`puter.kv.list()`](/KV/list/).
- Changed Kimi K3 in [`puter.ai.chat()`](/AI/chat/#moonshot-kimi-models) to report the prompt tokens written to its cache as `cache_write_tokens` in `usage`, separate from `prompt_tokens`.
- Fixed [`puter.ai.chat()`](/AI/chat/) encoding a tool call's `arguments` twice when you sent an assistant message with `tool_calls` back to a model served through an OpenAI-compatible API.

## October 25, 2026

- Added key-value sharing (beta). A user can share the keys under a prefix with another Puter user at `watch`, `read`, or `write` access with [`puter.kv.share()`](/KV/share/), and the other user passes the share's `handle` to the [`puter.kv`](/KV/#sharing-with-other-users) methods. Manage shares with [`unshare()`](/KV/unshare/), [`listShared()`](/KV/listShared/), and [`listSharedByMe()`](/KV/listSharedByMe/).
- Added the `onlyIfAbsent` option to [`puter.kv.set()`](/KV/set/). It writes the key only when the key has no live entry, and resolves to `false` otherwise.
- Added the `'fs'`, `'backgroundEvents'`, and `'kvShare'` resources to [`puter.perms.request()`](/Perms/request/) and [`puter.perms.check()`](/Perms/check/), with the `puter.perms.Resource`, `puter.perms.Access`, and `puter.perms.Folder` constants. The `'permission'` resource and raw permission strings are deprecated.
- Fixed [`puter.perms.check()`](/Perms/check/) returning `false` for a file inside a folder your app already has access to, which made [`puter.perms.request()`](/Perms/request/) prompt again.
- Added the `viaWorker` field to filesystem and key-value [events](/Events/subjects/#the-event). It's `true` when server-side code running as the account, such as a worker, made the change.

## October 23, 2026

- Fixed Puter.js calls made with an expired session rejecting with `Unauthorized` even after the user signed in again. Puter.js retries the call once with the new session.

## October 22, 2026

- Changed how a stopped [`puter.ai.chat()`](/AI/chat/) stream is billed. Once the request reaches the model, the model finishes its response and the whole response is billed, even if you break out of the stream or abort it with an `AbortSignal`.
- Fixed [`puter.workers.delete()`](/Workers/delete/) removing the worker when Puter couldn't take its script down, and rejecting when the script was already gone. A call that fails keeps the worker, so you can call it again.

## October 21, 2026

- Fixed [`puter.fs.read()`](/FS/read/) ignoring the `offset` and `byte_count` options. Without `byte_count`, the read goes from `offset` to the end of the file.
- Fixed [`puter.auth.signIn()`](/Auth/signIn/) calls made at the same time sharing one sign-in window. Each call opens its own window and completes from it.

## October 20, 2026

- Added the `inputVideo` option to [`puter.ai.txt2vid()`](/AI/txt2vid/) to edit a video you supply, with the prompt describing the change. See [Video input](/AI/txt2vid/#video-input).
- Added `Blob`, `File`, and Puter file paths as image inputs to [`puter.ai.txt2img()`](/AI/txt2img/) and [`puter.ai.txt2vid()`](/AI/txt2vid/). Puter.js uploads a `Blob`, a `File`, or a `data:` URI over 1 MiB to a temporary file in the user's storage for the length of the call.
- Fixed `isDir` being `false` for a folder your app is opened with, in the [`FSItem`](/Objects/fsitem/) objects that [`puter.ui.onLaunchedWithItems()`](/UI/onLaunchedWithItems/) passes to your handler.

## October 19, 2026

- Fixed Gemini text-to-speech in [`puter.ai.txt2speech()`](/AI/txt2speech/) failing on audio longer than about 65 seconds.
- Fixed [`getAuthToken()`](/supported-platforms/#node-js) in Node.js leaving its local sign-in server running after the user signed in. The call rejects when it can't open the browser.

## October 17, 2026

- Fixed [`puter.ui.showOpenFilePicker()`](/UI/showOpenFilePicker/), [`puter.ui.showSaveFilePicker()`](/UI/showSaveFilePicker/), and [`puter.ui.showDirectoryPicker()`](/UI/showDirectoryPicker/) on websites resolving with a message object when the user cancels. The promise stays pending, and [`showDirectoryPicker()`](/UI/showDirectoryPicker/) gets the same `undefinedOnCancel` promise as the file pickers, which resolves to `undefined`.
- Fixed Gemini text-to-speech in [`puter.ai.txt2speech()`](/AI/txt2speech/) reading the `instructions` aloud along with the text. Gemini uses them only to guide the delivery, and they can be up to 3,000 characters.
- Fixed Gemini function calling in [`puter.ai.chat()`](/AI/chat/) dropping the thought signature in `extra_content` when you send an assistant message's `tool_calls` back.
- Removed OpenRouter's `:batch` model variants from [`puter.ai.listModels()`](/AI/listModels/). Use the model id without the `:batch` suffix.
