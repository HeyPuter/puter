# Browser push client

Puter's desktop shows pushes through `/sw.js`. Core registers it, and shows Settings → Notifications, only when the `pushEnabled` gui param is `true`; core never sets it. A backend extension that delivers pushes sets it with `services.homepage.setGuiParam('pushEnabled', true)` and can load its own code into the worker with `services.homepage.registerServiceWorkerScript(path)`.

Core does not subscribe the browser to a push service, and it has no `/push/*` routes. The device, app and preference endpoints below come from that extension. On a deployment without one, such as most self-hosted servers, they answer core's plain 404 (`code: 'not_found'`), which `puter.notifications` reports as `push_unavailable` and the Notifications tab shows as unavailable. A device the extension can't find is `device_not_found`.

## Push payload

`sw.js` reads the push's JSON body. The message is its `puter` field, or `data.puter` for services that only carry string data, as an object or a JSON string:

```ts
{ uid?: string; title?: string; body?: string; icon?: string; group?: string;
  target?: { app?: string; path?: string }; data?: unknown }
```

`uid` is the notification's uid, a later push with the same `group` replaces the one showing, and `target` and `data` reach the app when the user taps it.

When the browser replaces the subscription (`pushsubscriptionchange`), `sw.js` posts `{ type: 'puter-push-subscription-changed' }` to every open window on Puter's origin. The worker has no token or session, so the page's push client registers the new subscription.

## Registering

The registry is in [src/gui/src/helpers/pushClient.js](../src/gui/src/helpers/pushClient.js). A service script registers its client like this:

```js
service_script(async (api) => {
    api.use()['push.registerPushClient']?.(client);
});
```

`use(id)` throws when nothing is registered under `id`, so the form above also runs on a Puter version without the registry and does nothing there. Any script that runs after the GUI bundle can call `use()['push.registerPushClient']?.(client)` the same way. Registering again replaces the client. Registering dispatches `push-client-registered` on `window`, and an open Notifications tab redraws.

With no client registered, the tab says push notifications aren't available in this browser.

## Interface

```ts
interface PushClient {
    enable(): Promise<{ deviceUid: string }>;
    disable(): Promise<void>;
    status(): Promise<{
        permission: 'default' | 'granted' | 'denied';
        registered: boolean;
        deviceUid?: string;
    }>;
}
```

- `enable()` may ask for notification permission, so core calls it from a click: Turn on in the Notifications tab, Allow on a permission prompt that includes `notifications:push` while this browser is off, and the "Turn on notifications" button of the `/action/enable-push` popup and the matching desktop dialog (`UIEnablePushDialog`). Core also calls it without a click, from `helpers/pushSync.js`, when `Notification.permission` is already `granted`, `status()` reports the browser as not registered, the user has not turned push off in this browser, and an app holds `notifications:push`; the browser does not prompt then. It subscribes with the `/sw.js` registration, registers the device with `POST /push/devices` (`platform: 'web'`), and resolves the device `uid` the server returned. It rejects when permission is refused or the device couldn't be registered.
- `disable()` unsubscribes and removes this browser's device with `DELETE /push/devices/:uid`. The tab calls it for Turn off, and for Remove on the device marked as this browser; Remove on any other device is a plain `DELETE`.
- `status()` reports the state without prompting. `permission` is `Notification.permission`. `registered` is true when this browser has a device registered for the signed-in user, and `deviceUid` is that device's `uid`.

After `enable()` resolves, the tab calls `POST /push/devices/:uid/test` and asks the user whether a notification showed up.

The tab also reads `GET /push/apps` and `GET`/`POST /push/preferences`.

Core keeps its own record of a browser the user turned off, `puter.push.browser-off:<user uuid>` in `localStorage`, written by Turn off and by Remove on this browser's device, and cleared when `enable()` resolves. The silent registration above skips a browser with that record, so a device removed here stays removed while one removed from another device, or a new sign-in in a browser that already allows notifications, registers again.
