---
title: puter.notifications.notify()
description: Send the user a notification from your app. It shows in their Puter notifications panel, and as a push when no page of the app receives it live.
platforms: [websites, apps]
---

Sends the user your app runs for a notification. It shows in their Puter notifications panel and reaches your app through [`onNotification()`](/Notifications/onNotification/) while it's open. When no page of your app receives it live within 5 seconds, it also goes out as a push notification, if the user [allowed pushes](/Notifications/requestPermission/) from your app and has push notifications turned on on a device.

Only an app can send notifications: an app running on Puter, or a website using Puter.js. Every notification carries your app's name, and a user gets at most 12 pushes a minute and 1,000 a day from each app (the rest still show in the panel).

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
- `group` (String): Notifications with the same group are shown together. Letters, digits and `. _ : -`, up to 64 characters.
- `channel` (String): What kind of notification it is, such as `messages` or `reminders`. Lowercase letters, digits and `-`, up to 32 characters.
- `sensitive` (Boolean): Pushes show a generic line instead of the title and text. The notifications panel still shows them.
- `priority` (String): Only `'normal'` is available to apps.
- `ttl` (Number): How long, in seconds, a push may wait for a device that's offline. 1 to 86400, default 3600. It doesn't change how long the notification is kept.

## Return value

A `Promise` that resolves to the new notification's `uid` (String).

It rejects with an error carrying `message` and `code`:

| `code` | Meaning |
| --- | --- |
| `invalid_argument` | `notification` isn't an object, or has no `title`. |
| `bad_request` | A field is over its limit, has the wrong type, or isn't one of the fields above. The message names the field. |
| `forbidden` | The call wasn't made by an app, for example from Node.js with an account token. |
| `too_many_requests` | Your app sent this user too many notifications. See [Rate Limits and Quotas](/rate-limits-and-quotas/#notifications). |
| `auth_canceled` | Nobody was signed in, and the user closed the sign-in without finishing it. |

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

<strong class="example-title">Keep the content out of pushes</strong>

```js
await puter.notifications.notify({
    title: 'Your test results are in',
    text: 'Open the app to see them.',
    sensitive: true,
    target: '/results',
});
```
