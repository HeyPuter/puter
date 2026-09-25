---
title: puter.ui.launchApp()
description: Dynamically launches another app from within your app.
platforms: [apps]
---

Allows you to dynamically launch another app from within your app.

## Syntax
```js
puter.ui.launchApp()
puter.ui.launchApp(appName)
puter.ui.launchApp(appName, args)
puter.ui.launchApp(options)
```

## Parameters
#### `appName` (String)
Name of the app. If not provided, a new instance of the current app will be launched.

#### `args` (Object)
Arguments to pass to the app. If `appName` is not provided, these arguments will be passed to the current app.

#### `options` (Object)

#### `options.name` (String)
Name of the app. If not provided, a new instance of the current app will be launched.

#### `options.args` (Object)
Arguments to pass to the app.

#### `options.file_paths` (Array&lt;String&gt;)
Paths of existing files to open with the launched app.

#### `options.items` (Array&lt;[`FSItem`](/Objects/fsitem)&gt;)
`FSItem` objects to open with the launched app.

#### `options.pseudonym` (String)
A pseudonym to launch the app under.

#### `options.background` (Boolean)
If `true`, the app starts with its window hidden — for an app launched to do work
rather than to be looked at, such as one serving an API to yours over its
[`AppConnection`](/Objects/AppConnection). Without this, Puter creates and shows
the window before the app's own code runs, so a service app cannot avoid briefly
appearing on screen.

The instance stays private to your app for as long as it is hidden: it has no
taskbar item and no running mark on its icon, and opening the app from the
taskbar or from Puter's app list starts a separate, ordinary instance for the
user rather than handing them the one you are talking to. It can show itself at
any time with [`puter.ui.showWindow()`](/UI/showWindow), and from that moment it
is an ordinary window — it takes its place in the taskbar, and the user can
return to it, hide it, or close it like any other. Defaults to `false`.

A background app closes when the app that launched it closes: it was launched to
serve that app, and the user never saw it. Once it has shown itself it keeps
running on its own.

## Return value 
A `Promise` that will resolve to an [`AppConnection`](/Objects/AppConnection) once the app is launched.

When private-access routing applies, the resolved connection may include
`connection.response.launchResult` with fields such as:
- `requestedAppName`
- `openedAppName`
- `redirectedToFallback`
- `deniedPrivateAccess`

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // launches the Editor app
        puter.ui.launchApp('editor');
    </script>
</body>
</html>
```

Launching an app in the background to use it as a service, with no window
appearing on screen:

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const service = await puter.ui.launchApp({
                name: 'contacts',
                args: { service: 'contacts-api' },
                background: true,
            });
            service.on('message', (msg) => console.log('from contacts:', msg));
            service.postMessage({ hello: 'there' });
        })();
    </script>
</body>
</html>
```
