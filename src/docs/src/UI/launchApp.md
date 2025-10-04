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

## Return value 
A `Promise` that will resolve to an [`AppConnection`](/Objects/AppConnection) once the app is launched.

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
