---
title: Changelog
description: New features, changes, and fixes in Puter.js and the Puter APIs, grouped by day, newest first.
---

New features, changes, and fixes in Puter.js and the Puter APIs, grouped by day, newest first.

## November 12, 2026

- Changed [`puter.ui.showColorPicker()`](/UI/showColorPicker/) in Puter apps to open the same color picker it shows on websites. It resolves to a lowercase 6-digit hex string, such as `#ff0000`, or to `null` if the user closes the picker. Before, it resolved to an 8-digit hex string with alpha, or to `undefined`.
- Changed the `show_in_taskbar` option of [`puter.ui.createWindow()`](/UI/createWindow/) to have no effect, because the Puter desktop doesn't have a taskbar anymore.

## November 11, 2026

- Changed OpenAI's `service_tier` values `"priority"` and `"ultrafast"`, and Mistral's `"auto"`, in [`puter.ai.chat()`](/AI/chat/) to pick the matching service speed and bill at that speed's prices. A `serviceSpeed` you pass takes precedence. See [Model-specific features](/AI/chat/#model-specific-features).
- Changed [`puter.ai.speech2speech()`](/AI/speech2speech/) to reject any `model` other than `eleven_multilingual_sts_v2` or `eleven_english_sts_v2` with a `field_invalid` error.

## November 10, 2026

- Fixed [`puter.ai.chat()`](/AI/chat/) requests over 50 MiB failing with a `413` error. They're accepted up to 128 MiB. See [Rate Limits and Quotas](/rate-limits-and-quotas/#ai).

## November 9, 2026

- Added the `serviceSpeed` option to [`puter.ai.chat()`](/AI/chat/). Set it to `"standard"`, `"fast"`, or `"ultrafast"`. If a model doesn't offer the speed you ask for, the request uses the next slower one. Faster speeds can cost more, and `usageDetails.serviceSpeed` reports the speed that served the request. See [Service speed](/AI/chat/#service-speed).
- Added Claude Fable 5.2 (`claude-fable-5-2`) to [`puter.ai.chat()`](/AI/chat/). It supports the `"fast"` service speed.

## November 7, 2026

- Renamed `puter.ai.convo()` to [`puter.ai.realtime()`](/AI/realtime/) (beta). It takes the same options. Calls to `puter.ai.convo()` throw, so switch them to [`puter.ai.realtime()`](/AI/realtime/).

## November 6, 2026

- Changed [`puter.notifications.enable()`](/Notifications/enable/) on a website to show a Puter dialog when it isn't called directly from a click, instead of rejecting with `user_gesture_required`. The browser's permission prompt opens when the user clicks Continue, and [`enable()`](/Notifications/enable/) resolves to `false` if they click Cancel.

## November 5, 2026

- Added [`puter.notifications.markShown()`](/Notifications/markShown/) and [`puter.notifications.dismiss()`](/Notifications/dismiss/). After either one, the next notification with the same `group` creates a new notification instead of replacing it. A dismissal also closes the notification on the user's other devices where your app is open.
- Added the `dismiss` event to [`puter.notifications.on()`](/Notifications/on/). It fires with the `uid` of a notification dismissed on any of the user's devices.
- Added `priority: 'high'` to [`puter.notifications.notify()`](/Notifications/notify/) for pushes that need to arrive right away, such as incoming calls. High-priority pushes over the hourly limit go out at normal priority. See [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).
- Added `requireInteraction` and `actions` to what an [`onPush()`](/Notifications/onPush/) handler can return, so a push can stay on screen and show up to two buttons. The `click` handler of [`puter.notifications.on()`](/Notifications/on/) gets the pressed button's id as `action`.
- Changed when a notification sent with [`notify()`](/Notifications/notify/) goes out as a push. Puter skips the push only when a page of your app is visible and focused as the notification arrives. Pages in the background don't show the notification themselves. See [When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed).
- Added [`puter.events.updateSchedule()`](/Events/updateSchedule/) (beta) to change a schedule's timing or context, or a scheduled notification's send time and content, without changing its id.
- Added the `gpt-image-2.6-flare` and `gpt-image-2.6-sunburst` models to [`puter.ai.txt2img()`](/AI/txt2img/). The default model is `gpt-image-2.6-flare` instead of `gpt-image-2`.
- Added the `prompt_cache_options` option to [`puter.ai.chat()`](/AI/chat/) for GPT-5.6 and later OpenAI models. It sets a 30 minute or 12 hour cache lifetime. Cache writes for OpenAI models show in `usageDetails` as `cacheWrite30mTokens` and `cacheWrite12hTokens`.
- Added the `context_trimmed` event to `puter.ai.convo()`, now [`puter.ai.realtime()`](/AI/realtime/). It fires when older items are left out of the context restored after a reconnect. Before, that case fired an `error` event with `context_restore_failed`.
- Fixed `puter.ai.convo()`, now [`puter.ai.realtime()`](/AI/realtime/), ending the conversation when the server sent an event over 64 KiB, and its microphone capture stopping after a reconnect. Incoming events can be up to 4 MiB.
- Changed the [Realtime WebSocket API](/AI/realtime-websocket/) to answer `internal_error` and close with code 1011 when a server error stops Puter from checking your credential, instead of `invalid_api_key` with code 1008. Your client can reconnect after a 1011 close.
- Fixed input transcription on the [Realtime WebSocket API](/AI/realtime-websocket/) failing to turn on for users with little credit.

## November 4, 2026

- Added inline handlers to [`puter.events.onSchedule()`](/Events/onSchedule/) and [`puter.events.onPersistent()`](/Events/onPersistent/) (beta). Pass your code as `handler` without a `handlerName`, and Puter publishes it in the signed-in user's own [user scope](/Events/handlers/#user-scope). The app's owner doesn't have to publish a handler first.
- Added the `scope: 'user'` option to [`puter.events.handlers`](/Events/handlers/) and [`puter.events.workers`](/Events/workers/), and the `handlerScope` option to [`onSchedule()`](/Events/onSchedule/) and [`onPersistent()`](/Events/onPersistent/). A user's session can publish named handlers in its own scope and bind schedules and subscriptions to them.
- Added a limit on how many worker units a user can hold at once. Workers from [`puter.workers.create()`](/Workers/create/), user scopes, and the events workers of apps the user owns all count. Creating one over the limit fails with `forbidden`. See [Worker units](/rate-limits-and-quotas/#worker-units).
- Added the `from` option to [`puter.events.fetch()`](/Events/fetch/) (beta). With `from: 'end'`, a read without a cursor returns no items and a cursor at the newest notification, so later reads return only newer notifications.
- Added `puterPush.savedHandlers(false)` for the push service worker. It runs only the handlers registered in the worker, and skips handler source your pages saved with [`onPush()`](/Notifications/onPush/#handlers-in-the-worker). The `off()` function that [`onPush()`](/Notifications/onPush/) returns keeps the saved handler while another tab in the same browser still uses it.
- Fixed [`puter.notifications.enable()`](/Notifications/enable/) rejecting with `push_subscription_conflict` when the browser had an older Puter subscription with a different key, and pushes stopping after the browser replaced its subscription.

## November 3, 2026

- Added schedules to the [Events API](/Events/) (beta). A published handler can run at an interval, on a cron expression in a time zone, or once at a set time, even while your app is closed. Create one with [`puter.events.onSchedule()`](/Events/onSchedule/), and manage them with [`listSchedules()`](/Events/listSchedules/), [`getSchedule()`](/Events/getSchedule/), and [`removeSchedule()`](/Events/removeSchedule/).
- Added the `sendAt` option to [`puter.notifications.notify()`](/Notifications/notify/#send-it-later) to send a notification at a set time, even while your app is closed. To cancel it before it goes out, use [`puter.notifications.cancel()`](/Notifications/cancel/). With a `sendAt` more than 5 seconds ahead, [`notify()`](/Notifications/notify/) resolves to `{ scheduleId, sendAt }` instead of a notification `uid`.
- Changed [`puter.auth.signOut()`](/Auth/signOut/) to return a `Promise`. On a website, signing out ends this browser's push subscription for your app, and the promise resolves once that's done.
- Changed [`puter.notifications.disable()`](/Notifications/disable/) and [`puter.auth.signOut()`](/Auth/signOut/) to remove only the push subscription Puter made. A subscription from another push service on your site stays in place.
- Fixed taps on push notifications on a website. A tap opens one page, once. A relative URL, or a tap on a notification without a URL, opens from your site's root instead of your service worker's folder.
- Fixed [`onPush()`](/Notifications/onPush/) opening Puter's sign-in window when it renewed the push subscription on page load, and other tabs subscribing again after [`disable()`](/Notifications/disable/) was called in one tab.
- Fixed [`puter.ui.showFontPicker()`](/UI/showFontPicker/) in Puter apps ignoring the default font, and failing when given a font name as a string.

## November 2, 2026

- Changed [`puter.notifications.status()`](/Notifications/status/) on a website to check this browser's subscription with Puter. It resolves to `'off'` after the user removes the browser or turns your app off in Puter's settings. Page loads don't turn pushes back on in a removed browser until your page calls [`enable()`](/Notifications/enable/) again.
- Fixed [`puter.kv.set()`](/KV/set/) and other writes rejecting some values over [`MAX_VALUE_SIZE`](/KV/MAX_VALUE_SIZE/) with `bad_request`. Every value over the limit rejects with `value_too_large`.
- Fixed three [Workers router](/Workers/router/) responses. A 404 for an unmatched path or method carries the CORS header. A handler that returns a `fetch()` response doesn't turn into a 500 anymore. A Puter.js error thrown in a handler comes back as JSON in the 500 response.

## October 31, 2026

- Changed notifications sent with [`notify()`](/Notifications/notify/) to go only to your app, so they don't show in the Puter desktop's notifications panel. The `click` event of [`puter.notifications.on()`](/Notifications/on/) fires only for clicks on a push.
- Added [`puter.notifications.status()`](/Notifications/status/), which tells you whether your app's pushes reach the current browser, without prompting the user.
- Added the `notify` option to [`puter.kv.share()`](/KV/share/) (beta) and the `to: { handle }` field to [`notify()`](/Notifications/notify/), so the owner and the holder of a share can send each other notifications in your app. See [Notify the other side of a share](/Notifications/notify/#notify-the-other-side-of-a-share).
- Changed the `kv.share.received` notification to go out only for shares made with `notify: true`. To find every new share, call [`puter.kv.listShared()`](/KV/listShared/) when your app opens.
- Changed `group` in [`notify()`](/Notifications/notify/). A notification with a `group` replaces the newest one your app sent the user in that group, unless that one was shown or dismissed. It keeps that notification's `uid`, and [`onNotification()`](/Notifications/onNotification/) gets it again with `replaced: true`. See [Groups](/Notifications/notify/#groups).
- Raised the daily limit on notifications one app can send one user from 300 to 1,000. See [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).
- Added the `'pushNotifications'` resource to [`puter.perms.request()`](/Perms/request/#push-notifications), so you can ask for push permission in the same prompt as other access.
- Changed [`puter.notifications.enable()`](/Notifications/enable/) on a website to resolve once the browser answers and Puter has the subscription, without waiting for the confirmation push. If the confirmation doesn't arrive within 30 seconds, the `onError` handler of [`onPush()`](/Notifications/onPush/) gets a `push_verification_timeout` error.
- Changed [`enable()`](/Notifications/enable/) and [`enablePush()`](/Notifications/enablePush/) in Puter apps to show Puter's permission dialog when your app doesn't have push permission yet, instead of resolving to `false`. In Puter apps, [`disable()`](/Notifications/disable/) removes your app's push permission for the user.
- Changed the default `access` of a `'kvShare'` request in [`puter.perms.request()`](/Perms/request/) from `'watch'` to `'read'`, the same default as [`puter.kv.share()`](/KV/share/).
- Changed [`puter.kv.share()`](/KV/share/) so a call where every recipient already has the share, with the same access and label, doesn't count toward the share limits. Your app can call it each time it opens to get the `handle` back.
- Added a rate limit on calls through share handles into one user's data for one app. Calls over it reject with `too_many_requests`. See [Rate Limits and Quotas](/rate-limits-and-quotas/#key-value-store).
- Changed [`puter.events.onLocal()`](/Events/onLocal/) subscriptions through a KV share handle to end with `subscription_ended` and the reason `permission_revoked` when the share stops. A subscription through a `watch` share gets events without values, even with `includeValue`.
- Added [`puter.events.update()`](/Events/update/) (beta) to change a persistent subscription's `context` without ending it. The subscription keeps its `subId` and the events it hasn't delivered yet.
- Changed how failed [`puter.events.onPersistent()`](/Events/onPersistent/) handler runs count toward suspending a subscription. A run that fails because of Puter, such as a `5xx` or `429` error from a call through `user`, is retried without counting as a failure. A run longer than 30 seconds counts as a failure.
- Added `app_uid` and `app_name` to the [`WorkerDeployment`](/Objects/workerdeployment/) object from [`puter.workers.create()`](/Workers/create/), and `app_name` to the [`WorkerInfo`](/Objects/workerinfo/) object. They name the app the worker runs as.
- Added the `fallback` option to [`puter.ai.chat()`](/AI/chat/). Set it to `false` to get the error from the first vendor tried, instead of Puter retrying the request on another vendor that serves the same model.
- Raised the largest request body that [`puter.ai.chat()`](/AI/chat/) and the OpenAI- and Anthropic-compatible endpoints accept from 50 MiB to 128 MiB. See [Rate Limits and Quotas](/rate-limits-and-quotas/#ai).
- Changed how `puter.ai.convo()`, now [`puter.ai.realtime()`](/AI/realtime/), reconnects. It retries for about a minute, waits up to two minutes for an offline browser to come back online, and restores recent conversation items before `ready` fires.
- Added the `puter.reconnect` event to the [Realtime WebSocket API](/AI/realtime-websocket/). Puter sends it before the server a session runs on restarts, so your client can open a new connection and switch to it.
- Added the `dnsProvider` and `redirectFrom` fields to the [`CustomDomain`](/Objects/customdomain/) object. When a root domain's DNS is on Route 53 or GoDaddy, the domain is added as its `www.` hostname, and an `A` record with the purpose `redirect` forwards the root domain to it.

## October 30, 2026

- Added `puter.ai.convo()` (beta), renamed to [`puter.ai.realtime()`](/AI/realtime/) on November 7, for realtime text and voice conversations with OpenAI realtime models such as `gpt-realtime-2.1-mini`. It has optional microphone, speaker, and interruption helpers, and needs a paid Puter plan.
- Added the [Realtime WebSocket API](/AI/realtime-websocket/) (beta) for sending and receiving OpenAI realtime events through Puter without Puter.js.
- Changed [`notify()`](/Notifications/notify/) to push a notification only when none of your app's open pages answers within 5 seconds that it's visible and focused, or that it shows the notification itself. See [When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed).
- Changed push opt-in on websites to stay off until your page turns it on. On page loads, [`onPush()`](/Notifications/onPush/) keeps a browser subscribed only after [`enable()`](/Notifications/enable/), and stops after [`disable()`](/Notifications/disable/), after the user turns your app off in Puter, or after [`puter.auth.signOut()`](/Auth/signOut/).
- Added error codes to [`enable()`](/Notifications/enable/), such as `push_worker_conflict` when another service worker controls the scope, and `user_gesture_required` when it isn't called from a click. A handler that [`onPush()`](/Notifications/onPush/) can't rebuild from source, such as a bound function, rejects with `invalid_handler`.
- Changed pushes that share a `group` in [`notify()`](/Notifications/notify/). A newer push replaces the one showing on the device and alerts the user again.
- Changed the URL of Puter's push service worker script to `https://js.puter.com/push-sw.js`. The old `https://js.puter.com/v2/push-sw.js` URL still works.
- Fixed [`puter.auth.signIn()`](/Auth/signIn/), [`puter.perms.request()`](/Perms/request/), and [`enablePush()`](/Notifications/enablePush/) showing nothing when the browser blocked the popup even after a click, such as in Safari and in iOS Home Screen web apps. They show a Continue dialog instead.

## October 29, 2026

- Added the [Notifications API](/Notifications/) for sending notifications to your app's user. Send one with [`notify()`](/Notifications/notify/), receive them while your app is open with [`onNotification()`](/Notifications/onNotification/) and [`onPush()`](/Notifications/onPush/), and handle clicks with [`on()`](/Notifications/on/).
- Added push notifications that reach the user's phone or computer while your app is closed. On a website, load Puter's `push-sw.js` in your service worker and turn pushes on with [`enable()`](/Notifications/enable/). In a Puter app, use [`requestPermission()`](/Notifications/requestPermission/), [`hasPermission()`](/Notifications/hasPermission/), and [`enablePush()`](/Notifications/enablePush/). Pushes are billed to the user who receives them, for each device a push reaches. See [Push notifications for your app](/Notifications/push/), and [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications) for notification limits and prices.
- Added the `notifications:push` app permission to [`puter.perms.request()`](/Perms/request/#push-notifications). Your app's notifications go out as pushes only while the user has granted it.

## October 28, 2026

- Added the `queue` option to [`puter.events.onPersistent()`](/Events/onPersistent/) (beta). It sends each event to one consumer at a time and retries it after a temporary failure. It replaces `delivery: 'single'`, which still works. Subscriptions from [`onPersistent()`](/Events/onPersistent/) and [`puter.events.list()`](/Events/list/) have a `queue` boolean in place of `delivery` and `targets`.
- Changed [`onPersistent()`](/Events/onPersistent/) subscriptions without `queue` to run the handler in your app's events worker and also send each event to every connected client. Before, each event went to only one of the two. The `targets` option is ignored.
- Changed queued deliveries to drop the event when the handler throws, instead of retrying it. Network errors, timeouts, rate limits, `5xx` errors, and errors thrown with `retry: true` are still retried. See [What happens when a handler fails](/Events/onPersistent/#what-happens-when-a-handler-fails).
- Lowered the time a connected client has to answer a queued delivery from 60 seconds to 15. After that, the events worker takes the event. See [Rate Limits and Quotas](/rate-limits-and-quotas/#events).
- Fixed [`puter.net.Socket`](/Networking/Socket/) and [`puter.net.tls.TLSSocket`](/Networking/TLSSocket/) sending data out of order when you wrote more data while data written before `open` was still going out. Also fixed a socket opening a second connection when an `open` listener threw, and never closing when an `error` listener threw.

## October 27, 2026

- Added [`puter.hosting.attach()`](/Hosting/attach/), which opens a Puter dialog where the user connects a domain they own to one of their websites. It resolves to a [`CustomDomain`](/Objects/customdomain/) object, or to `null` if the user closes the dialog.
- Fixed [`puter.perms.request()`](/Perms/request/) for the `'subdomains'` resource having no effect. With read access, [`puter.hosting.list()`](/Hosting/list/) and [`puter.hosting.get()`](/Hosting/get/) cover all of the user's websites, and write access adds [`puter.hosting.update()`](/Hosting/update/) and [`puter.hosting.delete()`](/Hosting/delete/).
- Fixed [`puter.ui.launchApp()`](/UI/launchApp/) never settling when the desktop can't launch the app. It rejects with `ipc_handler_failed`.
- Fixed [`puter.fs.copy()`](/FS/copy/) onto an existing file. With `overwrite`, the copy replaces the file, and without it the call rejects with `item_with_same_name_exists`. Copying an item onto itself with `overwrite` rejects instead of deleting the item.
- Fixed [`puter.fs.readdir()`](/FS/readdir/) ignoring `offset` on a `recursive` listing, and [`puter.fs.read()`](/FS/read/) failing on an empty file when given `offset` or `byte_count`.
- Changed [`puter.fs.listShared()`](/FS/listShared/) to include `holderTeam` on items shared with a team you're in, with `holder` set to `null`. Leaving an item you only have through a team with [`puter.fs.unshare()`](/FS/unshare/) rejects with `team_share`.
- Fixed [`puter.fs`](/FS/) calls, such as [`stat()`](/FS/stat/), failing again after the user signed back in from an expired session.
- Changed the `thumbnail` URLs on file items to stay the same for up to an hour, so the browser can cache them. See [Rate Limits and Quotas](/rate-limits-and-quotas/#filesystem).

## October 26, 2026

- Added Kimi K3.1 Pro (`kimi-k3.1-pro`) and Kimi K3.1 Pro Highspeed (`kimi-k3.1-pro-highspeed`) to [`puter.ai.chat()`](/AI/chat/).
- Added GPT-6.1 Terra (`gpt-6.1-terra`) to [`puter.ai.chat()`](/AI/chat/).
- Fixed [`puter.ai.chat()`](/AI/chat/) encoding a tool call's `arguments` twice when you sent an assistant message with `tool_calls` back to a model served through an OpenAI-compatible API.
- Added sharing with up to 50 users in one [`puter.kv.share()`](/KV/share/) call (beta). Pass an array of recipients, and the call resolves to one result per recipient.
- Added the `appUid` option to [`puter.kv.listShared()`](/KV/listShared/) and [`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) (beta), and the `state` option to [`listSharedByMe()`](/KV/listSharedByMe/) to list only live or only stopped shares. Stopped shares are kept for 30 days.
- Changed `watch` shares (beta) so the holder can list keys, without their values, with [`puter.kv.list()`](/KV/list/).
- Raised the limits on live KV shares per account and per app, and added a limit on shares with any one other user. See [Rate Limits and Quotas](/rate-limits-and-quotas/#key-value-store).

## October 25, 2026

- Added [`puter.kv.share()`](/KV/share/), [`puter.kv.unshare()`](/KV/unshare/), [`puter.kv.listShared()`](/KV/listShared/), and [`puter.kv.listSharedByMe()`](/KV/listSharedByMe/) (beta) to share the keys under a prefix with another Puter user at `watch`, `read`, or `write` access. The other user reads or changes the keys by passing the share's `handle` to the [`puter.kv`](/KV/#sharing-with-other-users) methods, and watches them with [events](/Events/subjects/#sharing-key-value-data-with-another-user).
- Added the `onlyIfAbsent` option to [`puter.kv.set()`](/KV/set/). It writes the key only when it has no live entry, and resolves to `false` otherwise.
- Added the `'fs'`, `'backgroundEvents'`, and `'kvShare'` resources to [`puter.perms.request()`](/Perms/request/) and [`puter.perms.check()`](/Perms/check/), with the `puter.perms.Resource`, `puter.perms.Access`, and `puter.perms.Folder` constants. The `'permission'` resource and raw permission strings are deprecated. A permission string that doesn't match a resource is denied without a prompt.
- Fixed [`puter.perms.check()`](/Perms/check/) returning `false` in an app for a file or folder inside a folder the app already had access to.
- Added the `viaWorker` field to file and key-value [events](/Events/subjects/#the-event) (beta). It's `true` when the change came from server-side code running as the account, such as a worker.

## October 24, 2026

- Added MiniMax video models to [`puter.ai.txt2vid()`](/AI/txt2vid/). They are `minimax-h3`, `minimax-h3-highspeed`, `minimax-h3-lite`, `minimax-h3-max`, `minimax-hailuo-2.3`, `minimax-hailuo-2.3-fast`, and `minimax-hailuo-02`. See [MiniMax models](/AI/txt2vid/#minimax-models).

## October 23, 2026

- Changed [`puter.net.Socket`](/Networking/Socket/), [`puter.net.tls.TLSSocket`](/Networking/TLSSocket/), and [`puter.net.fetch()`](/Networking/fetch/) so data you write to a socket before its `open` event is queued and sent once it opens. Writing to a closed socket throws.
- Fixed Puter.js calls made with an expired session rejecting with `Unauthorized` even after the user signed in again. Puter.js retries the call once with the new session.

## October 22, 2026

- Changed how a stopped [`puter.ai.chat()`](/AI/chat/) stream is billed. Breaking out of the stream, or aborting it with an `AbortSignal`, stops the output your app receives. Once the request reaches the model, the model finishes its response and the whole response is billed.
- Changed team seats over the owner's seat limit to have no free allowance. Those seats can only spend purchased credit. See [Rate Limits and Quotas](/rate-limits-and-quotas/#teams).

## October 21, 2026

- Fixed [`puter.fs.read()`](/FS/read/) ignoring the `offset` and `byte_count` options. Without `byte_count`, the read goes from `offset` to the end of the file.
- Fixed [`puter.auth.signIn()`](/Auth/signIn/) calls made at the same time sharing one popup window. Each call completes from its own sign-in window.

## October 20, 2026

- Added Kling models to [`puter.ai.txt2vid()`](/AI/txt2vid/), [`puter.ai.txt2img()`](/AI/txt2img/), and [`puter.ai.txt2speech()`](/AI/txt2speech/). The video models are `kling-3.0-turbo`, `kling-3.0`, `kling-3.0-omni`, `kling-o1`, `kling-2.6`, and `kling-2.5-turbo`. The image models are `kling-v3`, `kling-v3-omni`, `kling-image-o1`, and `kling-v2-1`. For speech, use `provider: 'kling'` with the `kling-tts` model.
- Added the `inputVideo` option to [`puter.ai.txt2vid()`](/AI/txt2vid/) to edit a video you supply, with the prompt describing the change. It works with `gemini-omni-1.1-flash`, `black-forest-labs/flux-3`, `kling-3.0-omni`, and `kling-o1`.
- Raised the time [`puter.ai.txt2vid()`](/AI/txt2vid/) waits for a clip from 10 minutes to 14. A job that takes longer fails with `upstream_timeout`.
- Added Puter file paths and `Blob` or `File` objects as image inputs to [`puter.ai.txt2img()`](/AI/txt2img/) and [`puter.ai.txt2vid()`](/AI/txt2vid/). Puter.js uploads a `Blob`, a `File`, or a data URI over 1 MiB to a temporary file in the user's storage, and deletes it after the call.
- Fixed [`puter.ui.onLaunchedWithItems()`](/UI/onLaunchedWithItems/) and [`puter.ui.onItemsOpened()`](/UI/onItemsOpened/) reporting a folder opened with your app as a file. A folder's item has `isDirectory` set to `true`.

## October 17, 2026

- Added Gemini 4 Argon (`gemini-4-argon`) to [`puter.ai.chat()`](/AI/chat/).
- Added Gemini 3.1 Flash-Lite (`gemini-3.1-flash-lite`) and Gemini 3 Flash Preview (`gemini-3-flash-preview`) back to [`puter.ai.chat()`](/AI/chat/).
- Removed OpenRouter's `:batch` model variants from the list that [`puter.ai.listModels()`](/AI/listModels/) returns.
- Added Gemini Omni (`gemini-omni-1.1-flash`) to [`puter.ai.txt2vid()`](/AI/txt2vid/). It makes a clip from a prompt, or from a prompt and one starting image.
- Added Gemini transcription to [`puter.ai.speech2txt()`](/AI/speech2txt/) with `provider: 'gemini'` and the `gemini-3.5-transcribe` model. It supports per-word timestamps and speaker labels.
- Fixed Gemini text-to-speech in [`puter.ai.txt2speech()`](/AI/txt2speech/) mixing the `instructions` into the text it speaks. Gemini gets them as separate style guidance.
- Changed Gemini text-to-speech in [`puter.ai.txt2speech()`](/AI/txt2speech/) to fail with `402 insufficient_funds` when the user's credit doesn't cover the model's full token budget, even for short text. See [Rate Limits and Quotas](/rate-limits-and-quotas/).
- Fixed [`puter.ui.showOpenFilePicker()`](/UI/showOpenFilePicker/), [`puter.ui.showSaveFilePicker()`](/UI/showSaveFilePicker/), and [`puter.ui.showDirectoryPicker()`](/UI/showDirectoryPicker/) resolving with a message object when the user cancels the picker on a website. If the user cancels, the promise stays pending.
- Added the `undefinedOnCancel` promise to [`puter.ui.showDirectoryPicker()`](/UI/showDirectoryPicker/), the same as the file pickers have. It resolves to `undefined` when the user cancels.

## October 15, 2026

- Fixed [`puter.email.sendTransactional()`](/Email/sendTransactional/) called through `user.puter` in a worker being sent and billed as the worker's owner instead of the signed-in user.
- Changed [`puter.email.sendTransactional()`](/Email/sendTransactional/) to read `path` attachments with the caller's file permissions. To attach a file from the worker owner's storage, pass its `uid`. An attachment that can't be read fails with `not_found`.

## October 14, 2026

- Fixed [`puter.kv.expire()`](/KV/expire/) on another app's data failing when your app had only the `kv:expire` [app data scope](/Perms/appData/).
- Changed [`puter.kv.remove()`](/KV/remove/) on another app's data to resolve to `null` when your app can delete that app's entries but not read them.

## October 13, 2026

- Added image input to the `z-ai/glm-5.3-flash` and `z-ai/glm-5.3-flashx` models in [`puter.ai.chat()`](/AI/chat/).
