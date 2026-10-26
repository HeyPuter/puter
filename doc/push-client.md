# Browser push client

Puter's desktop shows pushes through `/sw.js`, which core registers when the server has push enabled (`push.enabled`). Core does not subscribe the browser to a push service. A GUI extension does that by registering a push client, and Settings → Notifications drives it.

## Registering

The registry is in [src/gui/src/helpers/pushClient.js](../src/gui/src/helpers/pushClient.js). A service script registers its client like this:

```js
service_script(async (api) => {
    api.use('push.registerPushClient')(client);
});
```

Any script that runs after the GUI bundle can call `use('push.registerPushClient')(client)` the same way. Registering again replaces the client. Registering dispatches `push-client-registered` on `window`, and an open Notifications tab redraws.

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
