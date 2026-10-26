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

- `enable()` is called from a click, so it may ask for notification permission. It subscribes with the `/sw.js` registration, registers the device with `POST /push/devices` (`platform: 'web'`), and resolves the device `uid` the server returned. It rejects when permission is refused or the device couldn't be registered.
- `disable()` unsubscribes and removes this browser's device with `DELETE /push/devices/:uid`.
- `status()` reports the state without prompting. `permission` is `Notification.permission`. `registered` is true when this browser has a device registered for the signed-in user, and `deviceUid` is that device's `uid`.

After `enable()` resolves, the tab calls `POST /push/devices/:uid/test` and asks the user whether a notification showed up.

The tab also reads `GET /push/apps` and `GET`/`POST /push/preferences`.
