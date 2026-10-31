---
title: puter.notifications.notify()
description: Send a notification from your app to its user, or to the other side of a key-value share. It reaches your app live, and goes out as a push when the user isn't looking at it.
platforms: [websites, apps]
---

Sends a notification to the user your app runs for, or with `to` to the other side of a [key-value share](/KV/share/). It goes to your app, not the Puter desktop's notifications panel. Every open page of your app gets it live, on any of the user's devices, through [`onNotification()`](/Notifications/onNotification/) and [`onPush()`](/Notifications/onPush/). When no open page shows it to the user within 5 seconds, it also goes out as a push to the browsers where the user [turned pushes on](/Notifications/enable/) for your app. [When a notification is pushed](/Notifications/push/#when-a-notification-is-pushed) has the exact rule.

Only an app can send notifications, meaning an app running on Puter or a website using Puter.js. Every notification carries your app's name. On a website with nobody signed in, the call asks the user to sign in first, as other Puter.js calls do.

A user gets at most 30 notifications a minute and 1,000 a day from each app. Pushes have their own caps. A user gets at most 12 pushes a minute and 1,000 a day from each app, or 6 a minute and 200 a day from an app younger than 30 days or not approved for listing. A website using Puter.js starts out unlisted. Over a push cap, the notification still reaches your app live and the call still resolves. [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications) has every limit.

## Syntax
```js
puter.notifications.notify(notification)
```

## Parameters

#### `notification` (Object) (required)

- `title` (String) (required): Up to 120 characters. Line breaks become spaces.
- `text` (String): Up to 240 characters. Line breaks are kept.
- `icon` (String): An `https` URL to an image, up to 2,048 characters. Without it, your app's icon is used. A push that Puter shows always uses your app's icon.
- `target` (String): A path inside your app, starting with `/`, such as `/chats/42`. Up to 512 characters. A click hands it back to your app through [`on('click')`](/Notifications/on/). On a website, a tap on a push opens this path when no page of your site is open.
- `data` (any): A JSON value of up to 1 KB, handed back on click. Push services can read it, so put IDs in it, not personal content.
- `group` (String): A later notification with the same `group` replaces this one, as [Groups](#groups) describes. Up to 128 letters, digits and `. _ : @ -`.
- `channel` (String): What kind of notification it is, such as `messages` or `reminders`. The [`onPush()`](/Notifications/onPush/) handler registered with this key decides what its push shows. Up to 32 lowercase letters, digits and `-`.
- `sensitive` (Boolean): Pushes, and the notification a page of your app shows itself, name only your app, such as "New notification from Chat" for an app named Chat, instead of showing the title and text. On a website, a sensitive push carries no `channel`, `target` or `data`. So no [`onPush()`](/Notifications/onPush/) handler runs for it, a tap opens your service worker's scope (`/` by default), and [`on('click')`](/Notifications/on/) gets `null` for `target` and `data`. [`onNotification()`](/Notifications/onNotification/) still gets the whole notification.
- `priority` (String): Only `'normal'` is available to apps.
- `ttl` (Number): How many seconds a push may wait for a device that's offline, from 1 to 86400. Defaults to 3600. It doesn't change how long the notification is kept.
- `to` (Object): Send it to the other side of a key-value share instead, as `{ handle }` with the share's handle. See [Notify the other side of a share](#notify-the-other-side-of-a-share).

## Return value

A `Promise` that resolves to the notification's `uid` (String). When the notification replaced an earlier one in its [group](#groups), that's the earlier one's `uid`.

With `to`, the `Promise` resolves with no value, so the call doesn't reveal anything about the recipient's notifications.

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | `notification` isn't an object, or its `title` is missing or blank. |
| `bad_request` | A field is over its limit, has the wrong type, or isn't one of the fields above. The message names the field. With `to`, it must be an object with only a string `handle`. |
| `forbidden` | The call wasn't made by an app, for example from Node.js with an account token. |
| `too_many_requests` | Your app sent this user too many notifications. With `to`, the error is the same whether the recipient's limit or the [share limit](#notify-the-other-side-of-a-share) refused the call. |
| `subject_does_not_exist` | With `to`, the handle doesn't name a live share of this app's data that you're on either side of. |
| `kv_share_notify_not_enabled` | With `to`, the share wasn't made with `notify: true`. |
| `recipient_not_accepting_shares` | With `to`, the recipient blocked you or doesn't accept shares. |
| `service_unavailable` | With `to`, Puter couldn't check the share. Try again later. |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |

## Notify the other side of a share

A [key-value share](/KV/share/) of your app's data made with `notify: true` lets its two sides notify each other. With `to: { handle }`, the notification goes to the other side of that share, inside your app, instead of to the user your app runs for. The share's owner reaches the holder, and the holder reaches the owner. Only the two sides of the share can use the handle, and only from the app whose data it is. The call fails once the share is gone, or when it doesn't allow notifications or the recipient blocked you.

The notification counts against the recipient's limits from your app, the same as one your app sends them directly. On top of that, you can send each user at most 30 notifications a minute and 500 a day through your shares with them in one app. Its push goes only to browsers where the recipient turned pushes on for your app, and it's billed to the recipient, like any push. See [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications).

The notification carries your app's name, not the sender's. Put the sender in `title` or `text` if the recipient should see it.

## Groups

A notification with a `group` replaces the newest notification your app sent the same user with that `group`, as long as that one hasn't been shown or dismissed. The replacement keeps that notification's `uid` and takes the new content and time. Its push replaces the earlier one on the device and alerts the user again. A listener added with [`onNotification()`](/Notifications/onNotification/) gets the replacement too, with the same `uid` and `replaced: true`.

When the earlier notification was shown or dismissed, the call creates a new notification instead, and so does a call without a `group`. A tap on a push that Puter shows, such as one for an app inside the Puter desktop, dismisses its notification. Puter.js has no call that marks a notification shown or dismissed, so a group usually stays one notification that each new one replaces.

A replacement counts against the 30 notifications a minute but not the 1,000 a day. When it goes out as a push, it counts against the push limits like any other push.

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
            puter.print(`Sent ${uid}`);
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
