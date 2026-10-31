---
title: puter.notifications.notify()
description: Send the user a notification from your app, or the other side of a key-value share. It reaches your app live, and as a push when they aren't looking at the app.
platforms: [websites, apps]
---

Sends the user your app runs for a notification, or with `to` the other side of a [key-value share](/KV/share/). It goes to your app, not the Puter desktop's notifications panel, and reaches every open page of your app, on any of the user's devices, through [`onNotification()`](/Notifications/onNotification/) and [`onPush()`](/Notifications/onPush/). Puter asks those pages whether they received it. When no page answers within 5 seconds that it's visible and focused, or that it shows the notification itself, it also goes out as a push to the browsers where the user [turned pushes on](/Notifications/enable/) for your app. [Push notifications for your app](/Notifications/push/#when-a-notification-is-pushed) has the details.

Only an app can send notifications, meaning an app running on Puter or a website using Puter.js. Every notification carries your app's name. A user gets at most 30 notifications a minute and 1,000 a day from each app. A notification that replaces an earlier one in its [group](#groups) counts against the 30 a minute only.

Pushes have their own caps. A user gets at most 12 pushes a minute and 1,000 a day from each app, or 6 a minute and 200 a day from an app younger than 30 days or not approved for listing. A website using Puter.js starts out unlisted, so it gets the lower caps. Over a push cap, the notification still reaches your app live and the call still resolves. See [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

On a website with nobody signed in, it asks the user to sign in first, as other Puter.js calls do.

## Syntax
```js
puter.notifications.notify(notification)
```

## Parameters

#### `notification` (Object) (required)

- `title` (String) (required): Up to 120 characters, on one line.
- `text` (String): Up to 240 characters. Newlines are kept.
- `icon` (String): An `https` URL to an image. Without it, your app's icon is used.
- `target` (String): A path inside your app, starting with `/`, such as `/chats/42`. When the user clicks the notification it's handed back to your app through [`on('click')`](/Notifications/on/). Up to 512 characters.
- `data` (any): A JSON value of up to 1 KB, handed back on click. Push providers can read it, so put IDs in it, not personal content.
- `group` (String): A newer notification with the same group replaces the one showing, and the device alerts the user again. Letters, digits and `. _ : -`, up to 64 characters.
- `channel` (String): What kind of notification it is, such as `messages` or `reminders`. Lowercase letters, digits and `-`, up to 32 characters.
- `sensitive` (Boolean): Pushes, and the notification a page of your app shows itself, show a generic line instead of the title and text. A sensitive push carries no `channel`, `target` or `data`, so no [`onPush()`](/Notifications/onPush/) handler runs for it, a tap opens `/`, and [`on('click')`](/Notifications/on/) gets `null` for `target` and `data`. [`onNotification()`](/Notifications/onNotification/) still gets the whole notification.
- `priority` (String): Only `'normal'` is available to apps.
- `ttl` (Number): How long, in seconds, a push may wait for a device that's offline. 1 to 86400, default 3600. It doesn't change how long the notification is kept.
- `to` (Object): Send it to the other side of a key-value share instead, as `{ handle }` with the share's handle. See [Notify the other side of a share](#notify-the-other-side-of-a-share).

## Return value

A `Promise` that resolves to the notification's `uid` (String). When it replaced an earlier notification in its [group](#groups), that's the earlier notification's `uid`.

With `to`, the `Promise` resolves with no value, so the call tells you nothing about the recipient's notifications.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | `notification` isn't an object, or has no `title`. |
| `bad_request` | A field is over its limit, has the wrong type, or isn't one of the fields above. The message names the field. With `to`, it must be an object with only a string `handle`. |
| `forbidden` | The call wasn't made by an app, for example from Node.js with an account token. |
| `too_many_requests` | Your app sent this user too many notifications. With `to`, either the recipient got too many from your app or you sent them too many through your shares in this app, and the error is the same for both. See [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications). |
| `subject_does_not_exist` | With `to`, the handle doesn't name a live share of this app's data that you're on either side of. |
| `kv_share_notify_not_enabled` | With `to`, the share wasn't made with `notify: true`. |
| `recipient_not_accepting_shares` | With `to`, the other side blocked you, or doesn't accept shares. |
| `service_unavailable` | With `to`, Puter couldn't check the share. Try again later. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |

## Notify the other side of a share

A [key-value share](/KV/share/) of your app's data made with `notify: true` lets its two sides notify each other. With `to: { handle }`, the notification goes to the other side of that share, in your app, instead of to the user your app runs for. The owner of the share reaches the holder, and the holder reaches the owner. Nobody else can use the handle, and neither can another app.

The call fails when the share stopped, doesn't allow notifications, or the recipient blocked you. The errors are in the table above.

The notification counts against the recipient's limits from your app, the same as one your app sends them directly. You can also send the other side of your shares in one app at most 30 notifications a minute and 500 a day, across all those shares. A push goes out only to browsers where the recipient [turned pushes on](/Notifications/enable/) for your app, and it's billed to the recipient, like any push. See [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

The notification carries your app's name, as every notification does, and not who sent it. Put the sender in `title` or `text` if the recipient should see it.

## Groups

A notification with a `group` replaces the newest notification your app sent the same user with that `group`. The replacement keeps that notification's `uid` and gets the new content and time. When that notification was shown or dismissed, the call creates a new one instead, and so does a call without a `group`.

Puter.js doesn't mark your app's notifications shown or dismissed. The one thing that does is the user tapping the notification's push inside the Puter desktop, which dismisses it. So a group usually stays one notification that each new one replaces.

A listener added with [`onNotification()`](/Notifications/onNotification/) gets the replacement too, with the same `uid` and `replaced: true`.

The notification limits count notifications written. A replacement counts against the 30 a minute but not the 1,000 a day. The push limits count only pushes sent, so a notification that isn't pushed doesn't count against them. A replacement that goes out as a push counts like any other push.

## Examples

<strong class="example-title">Notify the user about a new message</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const uid = await puter.notifications.notify({
                title: 'New message from Ana',
                text: 'See you at 6?',
                target: '/chats/42',
                data: { chatId: 42 },
                channel: 'messages',
                group: 'chat-42',
            });
            puter.print(`sent ${uid}`);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Notify the other side of a share</strong>

```js
const share = await puter.kv.share({ prefix: 'room:42:', recipient: 'alice', access: 'write', notify: true });

await puter.notifications.notify({
    title: 'New message in Weekend trip',
    group: 'room:42',
    to: { handle: share.handle },
});
```

<strong class="example-title">Keep the content out of pushes</strong>

```js
await puter.notifications.notify({
    title: 'Your test results are in',
    text: 'Open the app to see them.',
    sensitive: true,
    target: '/results',
});
```
